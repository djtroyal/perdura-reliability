# Publishing a Perdura release

This is the maintainer checklist for the supported release channels. No Apple
Developer Program membership, Microsoft code-signing certificate, PyPI token,
or container-registry token is required.

## One-time publisher setup

### PyPI

Before the first `perdura` upload, create a PyPI pending Trusted Publisher with:

| Setting | Value |
|---|---|
| PyPI project | `perdura` |
| GitHub owner | `djtroyal` |
| Repository | `perdura-reliability` |
| Workflow | `release.yml` |
| Environment | `pypi` |

Create a GitHub Environment named `pypi`. Optional required-reviewer protection
is appropriate for a controlled release; do not add a PyPI API-token secret. The
release job exchanges GitHub's short-lived OIDC identity directly with PyPI.

### GitHub Container Registry

The workflow links the image to this repository and publishes it with the
repository `GITHUB_TOKEN`. GHCR initially creates a personal-account container
package as private. After its first creation, open the package settings for
`perdura-reliability`, choose **Change visibility → Public**, and confirm the
irreversible visibility change. Public visibility permits anonymous pulls.

GitHub does not expose a supported workflow API for this visibility change. On
the first container publication, the release workflow intentionally stops at its
anonymous-pull check. Change the package to Public, then use **Re-run failed
jobs**; PyPI publication and the GitHub Release have not occurred yet. The source
label already grants this repository's workflow administrative access for
subsequent versions.

## Release procedure

1. Choose the next stable version according to [VERSIONING.md](../VERSIONING.md).
2. Update `CHANGELOG.md`, then run:

   ```bash
   python tools/bump_version.py X.Y.Z
   python tools/check_version_consistency.py --expected X.Y.Z
   uv lock --check
   ```

3. Merge the reviewed release change to `main`.
4. Create the immutable `vX.Y.Z` tag on that exact commit and push it.
5. Confirm the release workflow passes before treating any channel as released.
6. From a clean workstation, verify:

   ```bash
   uv tool install --python 3.13.14 'perdura[app]==X.Y.Z'
   perdura --version
   perdura doctor
   docker pull ghcr.io/djtroyal/perdura-reliability:X.Y.Z
   gh attestation verify Perdura-X.Y.Z-linux-x64.tar.gz --repo djtroyal/perdura-reliability
   ```

The workflow publishes one exact Python wheel to PyPI, one Linux x86-64
standalone archive, and a Linux x86-64/ARM64 OCI manifest. The GitHub Release
has four project-supplied assets: the archive, wheel, consolidated verification
bundle, and that bundle's SHA-256 checksum. Per-delivery SBOMs, dependency
manifests, constraints, container identity, scientific assurance, and detailed
reports are retained inside the verification bundle instead of appearing as
separate downloads. The workflow fails closed if those identities do not agree
with the tag, commit, tested lock, and CI evidence.

## Superseded releases

Do not delete historical artifacts solely because the delivery policy changed.
Edit the prior GitHub Release notes to identify the new release as the supported
replacement. Retaining the original files preserves the historical record;
withdrawing support is a documentation and disposition decision, not an attempt
to rewrite what was previously published.
