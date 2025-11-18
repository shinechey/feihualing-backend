const { handleValidate } = require('../handlers');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  await handleValidate(req, res);
};

