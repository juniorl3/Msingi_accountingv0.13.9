# v0.6.4 TypeScript build correction

The export dialog function from `@tauri-apps/plugin-dialog` is imported as
`saveDialog` to avoid colliding with the component's existing React form
submit handler named `save`.

All native file-save dialogs now call `saveDialog({ defaultPath, filters })`.
The selected path is checked for cancellation before writing. Successful
writes display a success notice; write errors display an error notice.

This resolves:
- TS2353: `defaultPath` incorrectly inferred as a React FormEvent argument.
- TS1345: testing the void return value of the React form handler for truthiness.
