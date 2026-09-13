## ADDED Requirements

### Requirement: Opt-in local terminal transport

The AI build SHALL connect only to the exact native host com.lectern.agent, and the standard build SHALL contain no native transport or nativeMessaging permission.

#### Scenario: Standard reader installation
- **WHEN** a user installs the standard build
- **THEN** the AI entry is absent and the existing npm run check passes

#### Scenario: Unauthorized extension
- **WHEN** another extension tries to connect or a host receives an origin outside its built-in allowlist
- **THEN** the request is rejected before starting a PTY or selecting a directory

### Requirement: First use and repeated projects

The terminal SHALL provide installation guidance when the companion is missing, CLI guidance when the selected executable is missing, and one native directory association per actual project identity.

#### Scenario: First project
- **WHEN** the companion and CLI are available and a project has no association
- **THEN** the user selects its matching directory once and a live terminal opens beside the reader

#### Scenario: Reopen or same-name project
- **WHEN** an associated project is reopened
- **THEN** its directory is reused and another project with the same name cannot inherit that association

### Requirement: Lifecycle and distribution

The macOS companion SHALL bundle its runtime, authenticate the exact extension origin, negotiate a protocol version, and clean up its PTY when the port closes.

#### Scenario: User closes the dock
- **WHEN** the terminal panel closes
- **THEN** its native connection and PTY end and focus returns to the opener

#### Scenario: Incompatible companion
- **WHEN** the companion protocol is unsupported
- **THEN** the extension shows update guidance without starting a CLI or retrying indefinitely

#### Scenario: Public release
- **WHEN** a maintainer builds a release installer
- **THEN** missing signing, notarization, extension identity or HTTPS download configuration fails the build rather than producing an apparently production-ready package
