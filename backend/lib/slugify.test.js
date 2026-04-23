const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slugify');

test('lowercases and replaces spaces with hyphens', () => {
  assert.equal(slugify('My Task Title'), 'my-task-title');
});
