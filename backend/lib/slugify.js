function slugify(input) {
  return input.toLowerCase().replace(/ /g, '-');
}

module.exports = { slugify };
