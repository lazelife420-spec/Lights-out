# B1 — F-01 external platform blocker

Observed: 2026-08-23

## Authenticated owner/control-plane view

- Authenticated identity: `lazelife420-spec`.
- `GET /user`: 200 and identifies `lazelife420-spec`.
- `GET /repos/lazelife420-spec/Lights-out`: 200.
- Repository: `visibility=public`, `private=false`, `disabled=false`, `archived=false`, owner type `User`, authenticated permission `admin=true`.
- `GET /repos/lazelife420-spec/Lights-out/releases/tags/v11.1.2`: 200.
- Release: `draft=false`, `prerelease=false`, published `2026-08-23T21:57:30Z`.
- Sole asset: `Lights-Out-Portable-v11.1.2-win-x64.zip`, 153,940,180 bytes, GitHub digest `sha256:525ff7a28caf7eb590f5504abffb8b5b49e864ded2a5a5482d8d3a7367755b28`.
- `GET /users/lazelife420-spec`, even with the authenticated owner token: 404.

## Anonymous external view

The following all returned HTTP 404:

- `https://api.github.com/users/lazelife420-spec`
- `https://api.github.com/repos/lazelife420-spec/Lights-out`
- `https://api.github.com/repos/lazelife420-spec/Lights-out/releases/latest`
- `https://github.com/lazelife420-spec`
- `https://github.com/lazelife420-spec/Lights-out`
- `https://github.com/lazelife420-spec/Lights-out/releases/tag/v11.1.2`
- `https://github.com/lazelife420-spec/Lights-out/releases/download/v11.1.2/Lights-Out-Portable-v11.1.2-win-x64.zip`

Signed-out browser captures:

- `b1-anonymous-owner-404.png`
- `b1-anonymous-release-404.png`

## Cause boundary and disposition

The repository and release objects are healthy and public in the owner control plane, but the owning account itself is hidden from public resolution. A private-profile preference does not hide public repositories; repository visibility, release draft/prerelease state, repository disablement, and artifact state therefore do not explain the observation.

The remaining cause class is GitHub account/platform visibility enforcement. GitHub documents hiding an account from public view, restricting visibility, and suspending an account as platform moderation actions. The exact internal enforcement reason is not exposed by the repository or release APIs available to this tranche.

No repository setting can safely correct account-level visibility enforcement. No public/private toggle, release recreation, tag change, asset replacement, or history rewrite was attempted.

Disposition: `F-01 — EXTERNAL PLATFORM BLOCKER`.

Escalation evidence required by GitHub Support:

1. account `lazelife420-spec` can authenticate through `GET /user`;
2. authenticated repository state is `public`, `private=false`, `disabled=false`;
3. authenticated v11.1.2 release is published and its asset is uploaded with the frozen digest;
4. `/users/lazelife420-spec` and every anonymous account/repository/release/asset URL return 404;
5. request GitHub Support to identify and remove or explain the account-level public-visibility restriction.

F-19 remains observationally blocked because a genuine anonymous browser download is still impossible.
