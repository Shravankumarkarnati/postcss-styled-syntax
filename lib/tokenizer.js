'use strict';

/** @typedef {[string, string, ...number[]]} Token */
/** @typedef {{ ignoreErrors?: boolean, interpolations?: Array<{ start: number, end: number }> }} TokenizerOptions */

const SINGLE_QUOTE = "'".charCodeAt(0);
const DOUBLE_QUOTE = '"'.charCodeAt(0);
const BACKSLASH = '\\'.charCodeAt(0);
const SLASH = '/'.charCodeAt(0);
const NEWLINE = '\n'.charCodeAt(0);
const SPACE = ' '.charCodeAt(0);
const FEED = '\f'.charCodeAt(0);
const TAB = '\t'.charCodeAt(0);
const CR = '\r'.charCodeAt(0);
const OPEN_SQUARE = '['.charCodeAt(0);
const CLOSE_SQUARE = ']'.charCodeAt(0);
const OPEN_PARENTHESES = '('.charCodeAt(0);
const CLOSE_PARENTHESES = ')'.charCodeAt(0);
const OPEN_CURLY = '{'.charCodeAt(0);
const CLOSE_CURLY = '}'.charCodeAt(0);
const SEMICOLON = ';'.charCodeAt(0);
const ASTERISK = '*'.charCodeAt(0);
const COLON = ':'.charCodeAt(0);
const AT = '@'.charCodeAt(0);

// STYLED PATCH {
const DOLLAR_SIGN = '$'.charCodeAt(0);
// } STYLED PATCH

const RE_AT_END = /[\t\n\f\r "#'()/;[\\\]{}]/g;
const RE_WORD_END = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g;
const RE_BAD_BRACKET = /.[\n"'(/\\]/;
const RE_HEX_ESCAPE = /[\da-f]/i;

/**
 * @param {import('postcss').Input} input
 * @param {TokenizerOptions} [options]
 */
function tokenizer(input, options = {}) {
	let css = input.css.valueOf();
	let ignore = options.ignoreErrors;

	// STYLED PATCH {
	let interpolations = options.interpolations || [];
	// } STYLED PATCH

	/** @type {number} */
	let code;
	/** @type {number} */
	let next;
	/** @type {'"'| "'"} */
	let quote;
	/** @type {string} */
	let content;
	/** @type {boolean} */
	let escape;
	/** @type {boolean} */
	let escaped;
	/** @type {number} */
	let escapePos;
	/** @type {string} */
	let prev;
	/** @type {number} */
	let n;
	/** @type {Token} */
	let currentToken;

	let length = css.length;
	let pos = 0;
	/** @type {Token[]} */
	let buffer = [];
	/** @type {Token[]} */
	let returned = [];

	function position() {
		return pos;
	}

	/**
	 * @param {string} what
	 */
	function unclosed(what) {
		// @ts-expect-error -- .error is not defined in types, but actual code is present
		throw input.error('Unclosed ' + what, pos);
	}

	function endOfFile() {
		return returned.length === 0 && pos >= length;
	}

	/**
	 * @param {{ ignoreUnclosed: any; }} [opts]
	 */
	function nextToken(opts) {
		if (returned.length) {
			return returned.pop();
		}

		if (pos >= length) {
			return; // eslint-disable-line consistent-return
		}

		let ignoreUnclosed = opts ? opts.ignoreUnclosed : false;

		code = css.charCodeAt(pos);

		switch (code) {
			case NEWLINE:
			case SPACE:
			case TAB:
			case CR:
			case FEED: {
				next = pos;

				do {
					next += 1;
					code = css.charCodeAt(next);
				} while (
					code === SPACE ||
					code === NEWLINE ||
					code === TAB ||
					code === CR ||
					code === FEED
				);

				currentToken = ['space', css.slice(pos, next)];
				pos = next - 1;
				break;
			}

			case OPEN_SQUARE:
			case CLOSE_SQUARE:
			case OPEN_CURLY:
			case CLOSE_CURLY:
			case COLON:
			case SEMICOLON:
			case CLOSE_PARENTHESES: {
				let controlChar = String.fromCharCode(code);

				currentToken = [controlChar, controlChar, pos];
				break;
			}

			case OPEN_PARENTHESES: {
				prev = buffer.length > 0 ? /** @type {Token} */ (buffer.pop())[1] : '';
				n = css.charCodeAt(pos + 1);

				if (
					prev === 'url' &&
					n !== SINGLE_QUOTE &&
					n !== DOUBLE_QUOTE &&
					n !== SPACE &&
					n !== NEWLINE &&
					n !== TAB &&
					n !== FEED &&
					n !== CR
				) {
					next = pos;

					do {
						escaped = false;
						next = css.indexOf(')', next + 1);

						// STYLED PATCH {
						// Catch cases where interpolation inside url has brackets
						let interpolation = interpolations.find(
							(item) => item.start < next && next < item.end
						);

						if (interpolation) {
							next = css.indexOf(')', interpolation.end);
						}
						// } STYLED PATCH

						if (next === -1) {
							if (ignore || ignoreUnclosed) {
								next = pos;
								break;
							} else {
								unclosed('bracket');
							}
						}

						escapePos = next;

						while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
							escapePos -= 1;
							escaped = !escaped;
						}
					} while (escaped);

					currentToken = ['brackets', css.slice(pos, next + 1), pos, next];

					pos = next;
				} else {
					next = css.indexOf(')', pos + 1);
					content = css.slice(pos, next + 1);

					if (next === -1 || RE_BAD_BRACKET.test(content)) {
						currentToken = ['(', '(', pos];
					} else {
						currentToken = ['brackets', content, pos, next];
						pos = next;
					}
				}

				break;
			}

			case SINGLE_QUOTE:
			case DOUBLE_QUOTE: {
				quote = code === SINGLE_QUOTE ? "'" : '"';
				next = pos;

				do {
					escaped = false;
					next = css.indexOf(quote, next + 1);

					if (next === -1) {
						if (ignore || ignoreUnclosed) {
							next = pos + 1;
							break;
						} else {
							unclosed('string');
						}
					}

					escapePos = next;

					while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
						escapePos -= 1;
						escaped = !escaped;
					}
				} while (escaped);

				currentToken = ['string', css.slice(pos, next + 1), pos, next];
				pos = next;
				break;
			}

			case AT: {
				RE_AT_END.lastIndex = pos + 1;
				RE_AT_END.test(css);

				if (RE_AT_END.lastIndex === 0) {
					next = css.length - 1;
				} else {
					next = RE_AT_END.lastIndex - 2;
				}

				currentToken = ['at-word', css.slice(pos, next + 1), pos, next];

				pos = next;
				break;
			}

			case BACKSLASH: {
				next = pos;
				escape = true;

				while (css.charCodeAt(next + 1) === BACKSLASH) {
					next += 1;
					escape = !escape;
				}

				code = css.charCodeAt(next + 1);

				if (
					escape &&
					code !== SLASH &&
					code !== SPACE &&
					code !== NEWLINE &&
					code !== TAB &&
					code !== CR &&
					code !== FEED
				) {
					next += 1;

					if (RE_HEX_ESCAPE.test(css.charAt(next))) {
						while (RE_HEX_ESCAPE.test(css.charAt(next + 1))) {
							next += 1;
						}

						if (css.charCodeAt(next + 1) === SPACE) {
							next += 1;
						}
					}
				}

				currentToken = ['word', css.slice(pos, next + 1), pos, next];

				pos = next;
				break;
			}

			default: {
				// STYLED PATCH {
				if (code === DOLLAR_SIGN) {
					let interpolation = interpolations.find((item) => item.start === pos);

					if (interpolation) {
						next = interpolation.end;
						currentToken = ['word', css.slice(pos, next + 1), pos, next];
						buffer.push(currentToken);
						pos = next;
					}
					// } STYLED PATCH
				} else if (code === SLASH && css.charCodeAt(pos + 1) === ASTERISK) {
					next = css.indexOf('*/', pos + 2) + 1;

					if (next === 0) {
						if (ignore || ignoreUnclosed) {
							next = css.length;
						} else {
							unclosed('comment');
						}
					}

					currentToken = ['comment', css.slice(pos, next + 1), pos, next];
					pos = next;
				} else {
					RE_WORD_END.lastIndex = pos + 1;
					RE_WORD_END.test(css);

					if (RE_WORD_END.lastIndex === 0) {
						next = css.length - 1;
					} else {
						next = RE_WORD_END.lastIndex - 2;
					}

					// STYLED PATCH {
					let interpolation = interpolations.find(
						(item) => pos <= item.start && item.start <= next + 1
					);

					// Catching things like `.${css}`, where symbol is immediatelly followed by interpolation
					if (interpolation) {
						next = interpolation.end;
					}
					// } STYLED PATCH

					currentToken = ['word', css.slice(pos, next + 1), pos, next];
					buffer.push(currentToken);
					pos = next;
				}

				break;
			}
		}

		pos++;

		return currentToken;
	}

	/**
	 * @param {Token} token
	 */
	function back(token) {
		returned.push(token);
	}

	return {
		back,
		nextToken,
		endOfFile,
		position,
	};
}

module.exports = tokenizer;