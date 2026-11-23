"""Read-only page search over explicitly selected, hash-controlled local PDFs.

No uploads, arbitrary paths, PDF serving or persistent text redistribution.
Extraction is lazy and cached in memory; file/catalog identity changes discard
cached text. Physical PDF page numbers are never asserted to be printed pages.
"""
from collections import OrderedDict
import hashlib
import importlib.util
from importlib import resources
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()
ROOT = Path(__file__).resolve().parents[3]


def _reference_paths(source_root=ROOT):
    """Use the source catalog only in a checkout; installed apps ship metadata."""
    source_catalog = source_root / 'docs' / 'standards' / 'mil-hdbk-217f-evidence.json'
    configured = os.environ.get('PERDURA_REFERENCE_DIRECTORY', '').strip()
    directory = (Path(configured).expanduser().resolve() if configured else
                 source_root / 'docs' / 'references' if source_catalog.is_file() else
                 Path.home() / '.perdura' / 'references')
    catalog = (source_catalog if source_catalog.is_file() else
               resources.files('perdura_app').joinpath('data', 'reference-catalog.json'))
    return directory, catalog


REFERENCE_DIRECTORY, CATALOG = _reference_paths()
SELECTED_SOURCES = {
    'mil-hdbk-217f-notice-2': 'https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=53939',
    'ansi-vita-51-1-2013-r2018': 'https://www.vita.com/Standards',
    'mil-hdbk-338b': 'https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=54022',
}
_cache = OrderedDict()
_lock = threading.RLock()


class ReferenceSearchRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    query: str = Field(min_length=2, max_length=160)
    document_ids: list[str] = Field(min_length=1, max_length=3)
    match: Literal['all', 'any', 'phrase'] = 'all'
    limit: int = Field(30, ge=1, le=50)


def _documents():
    try:
        rows = json.loads(CATALOG.read_text(encoding='utf-8'))['documents']
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=503, detail='The local reference evidence catalog is unavailable.') from exc
    return {row['id']: row for row in rows if row.get('id') in SELECTED_SOURCES}


def _path(row):
    files = row.get('local_files', [])
    if len(files) != 1:
        raise ValueError('This search source requires one cataloged PDF.')
    filename = files[0]['filename']
    if Path(filename).name != filename or Path(filename).suffix.lower() != '.pdf':
        raise ValueError('The catalog filename is outside the permitted PDF namespace.')
    path = REFERENCE_DIRECTORY / filename
    if path.resolve().parent != REFERENCE_DIRECTORY.resolve():
        raise ValueError('Reference paths must remain inside the reference directory.')
    return path, files[0]['sha256']


def _signature(path):
    stat = path.stat()
    return stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def _sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _extract_pages(path):
    executable = shutil.which('pdftotext')
    if executable:
        try:
            process = subprocess.run([executable, '-layout', '-enc', 'UTF-8', str(path), '-'],
                                     capture_output=True, timeout=30, check=False)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('PDF extraction timed out; this document was not indexed.') from exc
        if process.returncode:
            raise ValueError('The PDF text extractor could not read this document.')
        if len(process.stdout) > 32*1024*1024:
            raise ValueError('Extracted text exceeds the local search size limit.')
        pages = process.stdout.decode('utf-8', errors='replace').split('\f')
        if pages and not pages[-1].strip():
            pages.pop()
    elif importlib.util.find_spec('pypdf') is not None:
        from pypdf import PdfReader
        from pypdf.errors import PyPdfError, DependencyError, DeprecationError
        try:
            reader = PdfReader(path)
            if len(reader.pages) > 2500:
                raise ValueError('The document exceeds the 2500-page search limit.')
            pages = [page.extract_text() or '' for page in reader.pages]
        except (PyPdfError, DependencyError, DeprecationError) as exc:
            raise ValueError('The installed PDF reader could not extract this document; source metadata remains available.') from exc
    else:
        raise ValueError('Page search is unavailable: install pdftotext or provide an environment with pypdf. Source metadata remains available.')
    if len(pages) > 2500 or sum(map(len, pages)) > 32*1024*1024:
        raise ValueError('The extracted document exceeds the local search limits.')
    if not any(page.strip() for page in pages):
        raise ValueError('No searchable text was found. This scan may require OCR; OCR is not performed here.')
    return [' '.join(page.split()) for page in pages]


def _index(row):
    path, expected = _path(row)
    try:
        signature = _signature(path)
    except FileNotFoundError as exc:
        raise ValueError('The cataloged PDF is not installed locally.') from exc
    if signature[1] > 100*1024*1024:
        raise ValueError('PDF exceeds the 100 MB local search limit.')
    key = (str(path.resolve()), expected, signature)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        # Remove text from any previous version, including a hash-mismatched
        # replacement. It must never remain visible under a new identity.
        for old in list(_cache):
            if old[0] == key[0]:
                del _cache[old]
        actual = _sha256(path)
        if actual != expected:
            raise ValueError('Local SHA-256 differs from the evidence catalog; page search withheld until identity is reviewed.')
        pages = _extract_pages(path)
        if _signature(path) != signature:
            raise ValueError('The PDF changed during indexing; retry after the source is stable.')
        value = {'sha256': actual, 'pages': pages}
        _cache[key] = value
        while len(_cache) > 3:
            _cache.popitem(last=False)
        return value


def _metadata(row):
    item = {'id': row['id'], 'title': row['title'], 'edition': row['document_number'], 'date': row['date'],
            'authority': row['authority'], 'review_status': row['review_status'],
            'source_url': SELECTED_SOURCES[row['id']], 'limitations': row.get('limitations', []),
            'available': False, 'status': 'not_installed', 'sha256': None, 'filename': None}
    try:
        path, expected = _path(row)
        item.update(filename=path.name, sha256=expected, available=path.is_file(), status='available_unindexed' if path.is_file() else 'not_installed')
        if path.is_file():
            key = (str(path.resolve()), expected, _signature(path))
            with _lock:
                if key in _cache:
                    item.update(status='hash_verified_indexed', pages=len(_cache[key]['pages']))
    except (ValueError, OSError) as exc:
        item.update(status='unavailable', reason=str(exc))
    return item


@router.get('/catalog')
def catalog():
    return {'documents': [_metadata(row) for row in _documents().values()],
            'extractor_available': bool(shutil.which('pdftotext') or importlib.util.find_spec('pypdf')),
            'scope': 'Selected local editions in the evidence catalog. Results cite physical PDF pages, not printed pagination.'}


@router.post('/search')
def search(req: ReferenceSearchRequest):
    documents = _documents()
    if any(key not in documents for key in req.document_ids) or len(set(req.document_ids)) != len(req.document_ids):
        raise HTTPException(status_code=400, detail='Select distinct documents from the reference catalog.')
    query = ' '.join(req.query.split()).casefold()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail='Enter at least two non-whitespace search characters.')
    terms = [query] if req.match == 'phrase' else query.split()
    results, statuses = [], []
    for key in req.document_ids:
        row = documents[key]
        try:
            indexed = _index(row)
        except (ValueError, OSError) as exc:
            statuses.append({'id': key, 'status': 'unavailable', 'reason': str(exc)})
            continue
        statuses.append({'id': key, 'status': 'searched', 'pages': len(indexed['pages']), 'sha256': indexed['sha256']})
        for page_number, text in enumerate(indexed['pages'], 1):
            folded = text.casefold()
            matches = [term in folded for term in terms]
            if not (any(matches) if req.match == 'any' else all(matches)):
                continue
            positions = [folded.find(term) for term in terms if term in folded]
            position = min(positions)
            start = max(position - 140, 0)
            snippet = ('…' if start else '') + text[start:start+700] + ('…' if start+700 < len(text) else '')
            results.append({'document_id': key, 'edition': row['document_number'], 'title': row['title'], 'date': row['date'],
                            'pdf_page': page_number, 'sha256': indexed['sha256'], 'source_url': SELECTED_SOURCES[key],
                            'snippet': snippet, 'matched_terms': [term for term, found in zip(terms,matches) if found],
                            'score': sum(folded.count(term) for term in terms)})
    results.sort(key=lambda item: (-item['score'], item['edition'], item['pdf_page']))
    return {'query': req.query, 'match': req.match, 'total_matching_pages': len(results),
            'results': results[:req.limit], 'truncated': len(results)>req.limit, 'documents': statuses,
            'page_basis': 'One-based physical PDF page; printed page labels may differ.'}
