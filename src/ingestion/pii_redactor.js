const fs = require('fs')
const crypto = require('crypto')

const RED_TRIGGERS = [
  /\bsalar(y|ies)\b/i,
  /\bcompensation\b/i,
  /\bbonus(es)?\b/i,
  /\bpay\s?band\b/i,
  /\bpay\s?grade\b/i,
  /\bremuneration\b/i,
  /\bmedical\s?record\b/i,
  /\bhealth\s?record\b/i,
  /\bdisabilit(y|ies)\b/i,
  /\bsick\s?leave\b/i,
  /\bdiagnosis\b/i,
  /\bperformance\s?review\b/i,
  /\bunderperform(ing)?\b/i,
  /\bperformance\s?improvement\s?plan\b/i,
  /\b(pip)\b/i,
  /\bprobation\b/i,
  /\bmisconduct\b/i,
  /\bdisciplinar(y|ily)\b/i,
  /\bgrievance\b/i,
  /\bhr\s?investigation\b/i,
  /\btermination\b/i,
  /\bredundanc(y|ies)\b/i,
  /\bdismissal\b/i,
  /\bretrenchment\b/i,
  /\binsurance\s?claim\b/i,
  /\bpersonal\s?data\s?export\b/i,
  /\bpsychological\s?assessment\b/i,
  /\bunion\s?(membership|negotiation)\b/i,
]

const AMBER_TRIGGERS = [
  /[STFG]\d{7}[A-Z]/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(\+65[\s-]?)?\d{4}[\s-]?\d{4}\b/,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /\bpassport\s?no?\b/i,
  /\bdate\s?of\s?birth\b/i,
  /\bemployee\s?id\b/i,
  /\bstaff\s?id\b/i,
]

function checksumString(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

function classifyContent(content) {
  if (!content || typeof content !== 'string') return 'GREEN'

  for (const pattern of RED_TRIGGERS) {
    if (pattern.test(content)) {
      return 'RED'
    }
  }

  for (const pattern of AMBER_TRIGGERS) {
    if (pattern.test(content)) {
      return 'AMBER'
    }
  }

  return 'GREEN'
}

function applyAmberTransformations(content) {
  const transforms = []
  let result = content

  // NRIC/FIN redaction (highest priority)
  if (/[STFG]\d{7}[A-Z]/.test(result)) {
    result = result.replace(/[STFG]\d{7}[A-Z]/g, '[REDACTED-ID]')
    transforms.push('nric_fin_redacted')
  }

  // Email anonymisation
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i.test(result)) {
    result = result.replace(/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Z]{2,})\b/gi, '[name]@$2')
    transforms.push('email_anonymised')
  }

  // Phone number redaction
  if (/\b(\+65[\s-]?)?\d{4}[\s-]?\d{4}\b/.test(result)) {
    result = result.replace(/\b(\+65[\s-]?)?\d{4}[\s-]?\d{4}\b/g, '[REDACTED-PHONE]')
    transforms.push('phone_redacted')
  }

  // Bank/card number redaction
  if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(result)) {
    result = result.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED-FINANCIAL]')
    transforms.push('financial_redacted')
  }

  return { content: result, transforms }
}

function logRedBlock(filePath, reason) {
  const logPath = require('path').join(__dirname, '../../logs/audit_log.jsonl')
  const entry = JSON.stringify({
    event: 'PII_BLOCK_RED',
    timestamp: new Date().toISOString(),
    file_path: filePath,
    reason,
  }) + '\n'
  try {
    fs.appendFileSync(logPath, entry, 'utf8')
  } catch (_) {}
}

function classify(content) {
  return classifyContent(content)
}

function redact(parsedFile) {
  const content = parsedFile.raw_text || ''
  const originalChecksum = checksumString(content)
  const classification = classifyContent(content)

  if (classification === 'RED') {
    const triggerMatch = RED_TRIGGERS.find(p => p.test(content))
    const reason = triggerMatch ? triggerMatch.toString() : 'unknown RED trigger'
    logRedBlock(parsedFile.file_path, reason)

    return {
      file_path: parsedFile.file_path,
      filename: parsedFile.filename,
      file_type: parsedFile.file_type,
      classification: 'RED',
      content: null,
      redacted: false,
      transforms_applied: [],
      blocked: true,
      block_reason: reason,
      original_checksum: originalChecksum,
      metadata: parsedFile.metadata,
    }
  }

  if (classification === 'AMBER') {
    const { content: transformed, transforms } = applyAmberTransformations(content)
    return {
      file_path: parsedFile.file_path,
      filename: parsedFile.filename,
      file_type: parsedFile.file_type,
      classification: 'AMBER',
      content: transformed,
      redacted: true,
      transforms_applied: transforms,
      blocked: false,
      block_reason: null,
      original_checksum: originalChecksum,
      metadata: parsedFile.metadata,
    }
  }

  return {
    file_path: parsedFile.file_path,
    filename: parsedFile.filename,
    file_type: parsedFile.file_type,
    classification: 'GREEN',
    content,
    redacted: false,
    transforms_applied: [],
    blocked: false,
    block_reason: null,
    original_checksum: originalChecksum,
    metadata: parsedFile.metadata,
  }
}

async function redactBatch(parsedFiles) {
  return Promise.all(parsedFiles.map(f => redact(f)))
}

module.exports = { classify, redact, redactBatch }
