"""Selected local editions: citation identity, lazy caching and path boundaries."""
import hashlib
import json
import shutil
from importlib import resources
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from routers import references


@pytest.fixture
def reference_client():
    app = FastAPI()
    app.include_router(references.router, prefix='/references')
    with TestClient(app) as client:
        yield client


@pytest.fixture
def real_extract_pages():
    return references._extract_pages


@pytest.fixture
def source(tmp_path, monkeypatch, real_extract_pages):
    folder = tmp_path / 'references'
    folder.mkdir()
    pdf = folder / 'selected.pdf'
    pdf.write_bytes(b'controlled edition one')
    row = {'id': 'selected', 'title': 'Selected handbook', 'document_number': 'HB-1 Revision A',
           'date': '2000-01-01', 'authority': 'Test authority', 'review_status': 'reviewed',
           'local_files': [{'filename': pdf.name, 'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest()}]}
    catalog = tmp_path / 'catalog.json'
    catalog.write_text(json.dumps({'documents': [row]}))
    monkeypatch.setattr(references, 'REFERENCE_DIRECTORY', folder)
    monkeypatch.setattr(references, 'CATALOG', catalog)
    monkeypatch.setattr(references, 'SELECTED_SOURCES', {'selected': 'https://example.org/official'})
    references._cache.clear()
    calls = []
    monkeypatch.setattr(references, '_extract_pages', lambda path: calls.append(path) or ['Cover', 'A failure rate depends on exposure.', 'A repair rate differs.'])
    yield pdf, row, catalog, calls
    references._cache.clear()


def test_lazy_page_search_cites_exact_identity(source):
    pdf, row, _, calls = source
    assert references.catalog()['documents'][0]['status'] == 'available_unindexed'
    assert calls == []
    request = references.ReferenceSearchRequest(query='failure rate', document_ids=['selected'])
    result = references.search(request)
    assert result['total_matching_pages'] == 1
    page = result['results'][0]
    assert page['pdf_page'] == 2
    assert page['edition'] == 'HB-1 Revision A'
    assert page['sha256'] == hashlib.sha256(pdf.read_bytes()).hexdigest()
    assert page['source_url'] == 'https://example.org/official'
    references.search(request)
    assert len(calls) == 1
    assert references.catalog()['documents'][0]['status'] == 'hash_verified_indexed'


def test_changed_file_discards_old_text_and_requires_catalog_hash(source):
    pdf, row, catalog, calls = source
    request = references.ReferenceSearchRequest(query='failure', document_ids=['selected'])
    references.search(request)
    pdf.write_bytes(b'a changed controlled edition')
    blocked = references.search(request)
    assert blocked['results'] == []
    assert 'SHA-256 differs' in blocked['documents'][0]['reason']
    assert not references._cache
    row['local_files'][0]['sha256'] = hashlib.sha256(pdf.read_bytes()).hexdigest()
    catalog.write_text(json.dumps({'documents': [row]}))
    assert references.search(request)['results'][0]['sha256'] == row['local_files'][0]['sha256']
    assert len(calls) == 2


def test_search_modes_and_allowlist(source):
    for mode, count in [('all', 0), ('any', 2), ('phrase', 0)]:
        result = references.search(references.ReferenceSearchRequest(query='failure repair', match=mode, document_ids=['selected']))
        assert result['total_matching_pages'] == count
    for ids in [['../../etc/passwd'], ['selected', 'selected']]:
        with pytest.raises(HTTPException):
            references.search(references.ReferenceSearchRequest(query='rate', document_ids=ids))


def test_catalog_paths_and_symlinks_cannot_escape(source):
    pdf, row, _, _ = source
    row['local_files'][0]['filename'] = '../outside.pdf'
    with pytest.raises(ValueError, match='namespace'):
        references._path(row)
    outside = pdf.parent.parent / 'outside.pdf'
    outside.write_bytes(b'outside')
    link = pdf.parent / 'linked.pdf'
    link.symlink_to(outside)
    row['local_files'][0]['filename'] = link.name
    with pytest.raises(ValueError, match='inside'):
        references._path(row)


def test_extractor_unavailable_is_explicit(tmp_path, monkeypatch):
    monkeypatch.setattr(references.shutil, 'which', lambda _: None)
    monkeypatch.setattr(references.importlib.util, 'find_spec', lambda _: None)
    with pytest.raises(ValueError, match='Page search is unavailable'):
        references._extract_pages(tmp_path / 'file.pdf')


@pytest.mark.skipif(not shutil.which('pdftotext'), reason='optional local PDF extractor unavailable')
def test_supplied_217f_page_search():
    rows = references._documents()
    if not references._path(rows['mil-hdbk-217f-notice-2'])[0].exists():
        pytest.skip('selected controlled PDF not installed')
    result = references.search(references.ReferenceSearchRequest(query='failure rate', document_ids=['mil-hdbk-217f-notice-2'], limit=2))
    assert result['total_matching_pages'] > 2
    assert result['truncated']
    assert result['results'][0]['pdf_page'] >= 1
    assert len(result['results'][0]['sha256']) == 64
    references._cache.clear()


def test_packaged_catalog_and_configured_missing_pdf_directory(tmp_path, monkeypatch):
    configured = tmp_path / 'supplied-pdfs'
    monkeypatch.setenv('PERDURA_REFERENCE_DIRECTORY', str(configured))
    directory, bundled = references._reference_paths(tmp_path / 'not-a-checkout')
    assert directory == configured
    assert 'perdura_app' in str(bundled)
    monkeypatch.setattr(references, 'REFERENCE_DIRECTORY', directory)
    monkeypatch.setattr(references, 'CATALOG', bundled)
    catalog = references.catalog()
    assert len(catalog['documents']) == 3
    assert all(doc['status'] == 'not_installed' and not doc['available'] for doc in catalog['documents'])
    out = references.search(references.ReferenceSearchRequest(query='failure', document_ids=['mil-hdbk-217f-notice-2']))
    assert out['results'] == []
    assert 'not installed locally' in out['documents'][0]['reason']


def test_bundled_catalog_matches_selected_controlled_metadata():
    canonical = references.ROOT / 'docs' / 'standards' / 'mil-hdbk-217f-evidence.json'
    if not canonical.is_file():
        pytest.skip('source evidence catalog not installed')
    source = json.loads(canonical.read_text())
    bundle = json.loads(resources.files('perdura_app').joinpath('data','reference-catalog.json').read_text())
    assert bundle['documents'] == [r for r in source['documents'] if r['id'] in references.SELECTED_SOURCES]


def test_pypdf_fallback_reads_actual_controlled_pdf(monkeypatch):
    pytest.importorskip('pypdf')
    rows = references._documents()
    if not references._path(rows['mil-hdbk-217f-notice-2'])[0].is_file():
        pytest.skip('selected controlled PDF not installed')
    original_which = references.shutil.which
    monkeypatch.setattr(references.shutil,'which',lambda name: None if name == 'pdftotext' else original_which(name))
    references._cache.clear()
    out = references.search(references.ReferenceSearchRequest(query='failure rate',document_ids=['mil-hdbk-217f-notice-2'],limit=2))
    assert out['documents'][0]['status'] == 'searched'
    assert out['total_matching_pages'] > 2
    assert out['results'][0]['pdf_page'] >= 1
    assert out['results'][0]['sha256'] == rows['mil-hdbk-217f-notice-2']['local_files'][0]['sha256']
    references._cache.clear()


@pytest.mark.parametrize('endpoint', ['catalog', 'search'])
@pytest.mark.parametrize('error_type', [PermissionError, ValueError])
def test_reference_http_errors_do_not_disclose_local_details(
        source, reference_client, monkeypatch, caplog, endpoint, error_type):
    private_path = '/private/operator-home/confidential/reference.pdf'
    diagnostic = f'private-diagnostic-sentinel: could not read {private_path}'

    def fail_signature(_path):
        raise error_type(diagnostic)

    monkeypatch.setattr(references, '_signature', fail_signature)
    response = (reference_client.get('/references/catalog') if endpoint == 'catalog'
                else reference_client.post('/references/search', json={
                    'query': 'failure', 'document_ids': ['selected']}))
    assert response.status_code == 200
    assert private_path not in response.text
    assert 'private-diagnostic-sentinel' not in response.text
    document = response.json()['documents'][0]
    assert document['status'] == 'unavailable'
    assert document['reason'] == (
        'This reference could not be read. Check the local PDF and reference configuration.')
    if endpoint == 'catalog':
        assert document['available'] is False
    else:
        assert response.json()['results'] == []
    assert diagnostic in caplog.text


def test_search_http_hides_unexpected_extractor_exception_and_cause(
        source, reference_client, monkeypatch, caplog):
    cause_detail = '/private/extractor/runtime/private-cause-sentinel'
    extractor_detail = 'private-extractor-sentinel: malformed internal object'

    def fail_extraction(_path):
        try:
            raise OSError(cause_detail)
        except OSError as exc:
            raise ValueError(extractor_detail) from exc

    monkeypatch.setattr(references, '_extract_pages', fail_extraction)
    response = reference_client.post('/references/search', json={
        'query': 'failure', 'document_ids': ['selected']})
    assert response.status_code == 200
    assert cause_detail not in response.text
    assert extractor_detail not in response.text
    assert response.json()['documents'][0]['reason'] == (
        'This reference could not be read. Check the local PDF and reference configuration.')
    assert response.json()['results'] == []
    assert references._cache == {}
    assert cause_detail in caplog.text
    assert extractor_detail in caplog.text


@pytest.mark.parametrize('failure', ['missing_pdf', 'hash_mismatch'])
def test_search_http_preserves_actionable_controlled_failures(
        source, reference_client, failure):
    pdf, _, _, _ = source
    if failure == 'missing_pdf':
        pdf.unlink()
        expected = 'The cataloged PDF is not installed locally.'
    else:
        pdf.write_bytes(b'unreviewed replacement document')
        expected = ('Local SHA-256 differs from the evidence catalog; page search '
                    'withheld until identity is reviewed.')
    response = reference_client.post('/references/search', json={
        'query': 'failure', 'document_ids': ['selected']})
    assert response.status_code == 200
    assert response.json()['documents'][0]['reason'] == expected
    assert response.json()['results'] == []


def test_pdf_reader_error_keeps_actionable_message_without_private_cause(
        source, reference_client, real_extract_pages, monkeypatch):
    pypdf = pytest.importorskip('pypdf')
    from pypdf.errors import PdfReadError

    private_detail = '/private/operator-home/private-pdf-reader-sentinel.pdf'

    def fail_reader(_path):
        raise PdfReadError(private_detail)

    monkeypatch.setattr(references.shutil, 'which', lambda _: None)
    monkeypatch.setattr(pypdf, 'PdfReader', fail_reader)
    monkeypatch.setattr(references, '_extract_pages', real_extract_pages)
    with pytest.raises(ValueError) as failure:
        references._extract_pages(source[0])
    assert isinstance(failure.value.__cause__, PdfReadError)
    assert private_detail in str(failure.value.__cause__)
    public_reason = references._public_unavailable_reason(failure.value)
    assert public_reason == (
        'The installed PDF reader could not extract this document; source metadata remains available.')
    assert private_detail not in public_reason
    response = reference_client.post('/references/search', json={
        'query': 'failure', 'document_ids': ['selected']})
    assert response.status_code == 200
    assert response.json()['documents'][0]['reason'] == public_reason
    assert response.json()['results'] == []
    assert private_detail not in response.text


def test_search_http_preserves_unavailable_extractor_reason(
        source, reference_client, real_extract_pages, monkeypatch):
    monkeypatch.setattr(references, '_extract_pages', real_extract_pages)
    monkeypatch.setattr(references.shutil, 'which', lambda _: None)
    monkeypatch.setattr(references.importlib.util, 'find_spec', lambda _: None)
    response = reference_client.post('/references/search', json={
        'query': 'failure', 'document_ids': ['selected']})
    assert response.status_code == 200
    assert response.json()['documents'][0]['reason'] == (
        'Page search is unavailable: install pdftotext or provide an environment '
        'with pypdf. Source metadata remains available.')
    assert response.json()['results'] == []
