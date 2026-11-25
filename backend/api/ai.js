/**
 * Roxy Main API — AI Chat module
 * This file is loaded by the Express backend at startup from backend/api/*.js.
 * Add your provider integration here and keep provider secrets in Railway variables.
 */
module.exports = {
  name: 'AI Chat',
  path: '/api/v1/ai/chat',
  method: 'POST',
  category: 'AI Tools',
  plan: 'Premium',
  description: 'Chat completion endpoint. Configure your AI provider to enable responses.',
  async execute(req, res) {
    const message = req.body && req.body.message;
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, code: 'MESSAGE_REQUIRED' });
    }

    // Example provider integration belongs here.
    // Read secrets with process.env on Railway; never put them in frontend code.
    return res.status(501).json({
      success: false,
      code: 'AI_PROVIDER_NOT_CONFIGURED',
      message: 'Configure the AI provider in backend/api/ai.js before enabling this endpoint.'
    });
  }
};
