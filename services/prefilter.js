// heuristic pre filtering logic
// Keywords aligned with SATT.pdf Component 2 Layer 1 requirements.
// SECURITY_KEYWORDS include BTC/bitcoin variants to catch msg_038 ("Send 2 BTC or we publish data").

const SPAM_KEYWORDS = [
  'seo', 'nigerian prince', 'buy followers', 'guaranteed traffic',
  'guaranteed rankings', 'viagra', 'wire transfer',
];

const URGENT_KEYWORDS = [
  'urgent', 'p0', 'legal', 'cease and desist', 'lawsuit', 'ransomware',
];

const SECURITY_KEYWORDS = [
  'ransomware', 'breach', 'suspicious login', 'hacked', 'stolen data',
  'btc', 'bitcoin', 'cryptocurrency', 'pay or we', 'send or we',
];

export function runPreFilter(email) {
  const { sender = '', subject = '', body = '' } = email;
  
  const contentToScan = `${subject} ${body}`.toLowerCase();
  
  const isInternal = sender.endsWith('@internal.com') || sender.endsWith('@mycompany.com');
  
  const isSpam = SPAM_KEYWORDS.some(keyword => contentToScan.includes(keyword)) || sender.includes('spammy');
  
  const hasSecurityFlag = SECURITY_KEYWORDS.some(keyword => contentToScan.includes(keyword));
  
  let initialUrgency = 'Low';
  if (hasSecurityFlag) {
    initialUrgency = 'Critical';
  } else if (URGENT_KEYWORDS.some(keyword => contentToScan.includes(keyword))) {
    initialUrgency = 'High';
  }
  
  const requiresHuman = initialUrgency === 'Critical';

  return {
    is_internal: isInternal,
    is_spam: isSpam,
    security_flag: hasSecurityFlag,
    initial_urgency: initialUrgency,
    requires_human: requiresHuman
  };
}
