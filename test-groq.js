// Groq API 测试脚本
const Groq = require('groq-sdk').default;

async function testGroq() {
  console.log('🧪 开始测试 Groq API...\n');

  const groq = new Groq({
    apiKey: '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',
  });

  console.log('📋 配置信息:');
  console.log('  - API Key:', 'gsk_...zBy (已隐藏部分)');
  console.log('  - Base URL:', 'https://api.groq.com/openai/v1');
  console.log('  - Model:', 'llama-3.1-8b-instant\n');

  try {
    console.log('🚀 发送测试请求...');
    
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: '你是一个测试助手。请简短回答。'
        },
        {
          role: 'user',
          content: '说"测试成功"'
        }
      ],
      temperature: 0.5,
      max_tokens: 100,
    });

    console.log('✅ API 调用成功!\n');
    console.log('📝 响应内容:');
    console.log('  -', completion.choices[0].message.content);
    console.log('\n✨ Groq API 工作正常！');
    
  } catch (error) {
    console.error('❌ API 调用失败!\n');
    console.error('错误信息:', error.message);
    console.error('状态码:', error.status);
    console.error('详细错误:', error.error);
    console.error('\n💡 可能的原因:');
    console.error('  1. API Key 无效或已过期');
    console.error('  2. API Key 权限不足');
    console.error('  3. 网络连接问题');
    console.error('  4. Groq 服务异常');
    console.error('\n🔗 获取新的 API Key: https://console.groq.com/keys');
  }
}

testGroq();
