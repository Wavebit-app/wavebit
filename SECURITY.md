# Security policy

Security fixes target the latest release and `main`.

Please report vulnerabilities privately through [GitHub's reporting form](https://github.com/Wavebit-app/wavebit/security/advisories/new). Never post tokens, cookies or account details in a public issue. Include the affected version, OS, reproduction steps and impact.

Particularly relevant areas are IPC validation, the session partitions and tokens for Spotify and YouTube, the media protocol, download tools and release automation.

Until signing is configured, release files are unsigned. The SHA-256 checksums published with each release detect changed downloads; they don't establish who published them.
