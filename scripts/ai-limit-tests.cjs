'use strict';
const assert = require('node:assert/strict');

process.env.AI_DAILY_LIMIT_ANON = '2';
process.env.AI_HOURLY_LIMIT_ANON = '2';
process.env.AI_DAILY_LIMIT_USER = '4';
process.env.AI_HOURLY_LIMIT_USER = '4';
process.env.AI_DAILY_LIMIT_IP = '20';
process.env.AI_SESSION_SECRET = 'test-secret-only';

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const { consumeAiQuota, issueAiSessionToken } = require('../api/_ai-limit');

function req(ip){ return { headers:{ 'x-forwarded-for':ip }, socket:{} }; }

(async()=>{
  const anonBody = { clientContext:{ visitorId:'test-anon-browser' } };
  const a1 = await consumeAiQuota({ req:req('203.0.113.10'), body:anonBody, aiCallType:'test' });
  const a2 = await consumeAiQuota({ req:req('203.0.113.10'), body:anonBody, aiCallType:'test' });
  const a3 = await consumeAiQuota({ req:req('203.0.113.10'), body:anonBody, aiCallType:'test' });
  assert.equal(a1.allowed, true);
  assert.equal(a2.allowed, true);
  assert.equal(a3.allowed, false, 'anonymous third AI call should be blocked with a limit of 2');
  assert.equal(a3.quota.tier, 'anonymous');

  const signed = issueAiSessionToken('test-user-subject');
  const userBody = { clientContext:{ visitorId:'same-browser', sessionToken:signed } };
  const userStates = [];
  for(let i=0;i<5;i++) userStates.push(await consumeAiQuota({ req:req('203.0.113.11'), body:userBody, aiCallType:'test' }));
  assert.equal(userStates[3].allowed, true);
  assert.equal(userStates[4].allowed, false, 'signed-in fifth AI call should be blocked with a limit of 4');
  assert.equal(userStates[0].quota.tier, 'user');
  assert.ok(userStates[0].quota.daily.limit > a1.quota.daily.limit, 'signed-in tier must have the higher allowance');

  console.log('AI limiter tests passed for anonymous and signed-in tiers.');
})().catch(error=>{ console.error(error); process.exit(1); });
