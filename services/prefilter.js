// heuristic pre filtering logic

const SPAM_KEYWORDS = ['seo', 'nigerian prince', 'buy followers', 'guaranteed traffic', 'viagra'];
const URGENT_KEYWORDS = ['urgent', 'p0', 'legal', 'cease and desist', 'lawsuit'];
const SECURITY_KEYWORDS = ['ransomware', 'breach', 'suspicious login', 'hacked', 'stolen data'];

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
