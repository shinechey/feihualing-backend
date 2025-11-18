const { handleBackground } = require('../handlers');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  await handleBackground(req, res);
};

