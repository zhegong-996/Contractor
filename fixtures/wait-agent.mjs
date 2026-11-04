// A protocol fixture, deliberately not a model or a real third-party agent.
console.log('协议验证完成，需要人工答复后才继续。\n```agent-autoloop\n' + JSON.stringify({ ask: [{
  title: '协议测试：等待人工选择', text: '验证本轮结束后不会因自己的回执重复唤醒。',
  options: ['保留当前结果', '继续下一轮'], about: '这是无模型调用的执行协议测试，仅继续收到明确答复后的工作。',
}] }) + '\n```');
