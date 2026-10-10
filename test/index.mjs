// Lets `node --test agent/test` run everything: node resolves this directory to index.mjs via package.json.
import "./unit.test.mjs";
import "./e2e.test.mjs";
