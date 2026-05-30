This is an infinite canvas note-taking application, but it is rendered on a non-Euclidean Poincaré hyperbolic disk. Therefore, a strong emphasis on non-Euclidean geometry knowledge is required.

The current application is merely a PoC; backwards compatibility does not need to be maintained. Please inform the user if you deem any architectural changes necessary during the development process.

## Coding Style

- Tell why, not what. Code should be self-explanatory, but when it isn't, comments should explain the reasoning behind the code, not just describe what it does.

## Design Principles

- Emphasize a type-first approach, adhering to the principle of Parse, don't validate. Prefer encoding invariants in the type system.
- Separation of Purity: Clearly distinguish between the pure and impure parts of the system.