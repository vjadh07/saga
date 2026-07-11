# saga

The transaction layer for AI agents.

Agents are starting to touch money and irreversible actions (book, pay, send, cancel). When one crashes halfway through, the world is left double-charged or half-finished. Saga stages every action, verifies it against ground truth, and commits or rolls it back, on an append-only ledger, so an agent can crash mid-task, restart, reconcile, and finish clean.

Hackathon build in progress. Design spec landing in docs/ next, see HANDOFF.md for state.
