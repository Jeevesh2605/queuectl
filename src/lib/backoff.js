'use strict';

function backoffSeconds(base, attempts) {
  const numericBase = Number(base);
  if (!Number.isFinite(numericBase) || numericBase <= 0) throw new Error('backoff-base must be a positive number');
  return numericBase ** attempts;
}

module.exports = { backoffSeconds };
