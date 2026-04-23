const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slugify');

test('lowercases and replaces spaces with hyphens', () => {
  assert.equal(slugify('My Task Title'), 'my-task-title');
});

test('strips non-alphanumeric characters', () => {
  assert.equal(slugify('Feature: Add Login!'), 'feature-add-login');
});

test('trims leading and trailing whitespace/hyphens', () => {
  assert.equal(slugify('   leading and trailing   '), 'leading-and-trailing');
});

test('collapses consecutive hyphens and spaces', () => {
  assert.equal(slugify('multi---hyphen   spaces'), 'multi-hyphen-spaces');
});

test('is idempotent on already-kebab input and preserves digits', () => {
  assert.equal(slugify('Already-kebab-case-123'), 'already-kebab-case-123');
});
