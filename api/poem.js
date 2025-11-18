const { handlePoem } = require('../handlers');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  await handlePoem(req, res);
};

