// A CommonJS module of the kind a codemod can lift to ES modules: named and
// default requires, a re-export, named exports, and one dynamic require that
// cannot be lifted without a person, so it must be refused rather than guessed.
const total = require("./total.js");
const { format } = require("./util.js");
const config = require("config");

function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

exports.subtotal = subtotal;
exports.total = total;
module.exports.format = format;

const plugin = require(config.pluginName);
module.exports.plugin = plugin;
