function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[()（）【】\[\]\/]/g, '')
    .trim();
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function buildKeywordText(rawDepartment, rawPosition, emailSubject) {
  return normalizeText(`${rawDepartment} ${rawPosition} ${emailSubject}`);
}

export function canonicalizeOnboardingDepartment(rawDepartment, context = {}) {
  const keywordText = buildKeywordText(rawDepartment, context.rawPosition, context.emailSubject);

  if (hasAny(keywordText, ['全球檢測', 'ICC'])) {
    if (hasAny(keywordText, ['技術支援部', '案件專員', '案件管理'])) return 'ICC / 技術支援部';
    if (hasAny(keywordText, ['業務部', '客服業務'])) return 'ICC / 業務部';
    if (hasAny(keywordText, ['工程部', '測試工程師'])) return 'ICC / 工程部';
    return 'ICC';
  }

  if (hasAny(keywordText, ['國際標準認證事業五部', 'WBU', '五部'])) {
    if (hasAny(keywordText, ['RF工程一部'])) return 'WBU / RF工程一部';
    if (hasAny(keywordText, ['SAR工程部'])) return 'WBU / SAR工程部';
    if (hasAny(keywordText, ['場測工程部'])) return 'WBU / 場測工程部';
    if (hasAny(keywordText, ['國際認證一部', '認證專員'])) return 'WBU / 國際認證一部';
    if (hasAny(keywordText, ['案件管理', 'RFPM', 'PM'])) return 'WBU / PM';
    if (hasAny(keywordText, ['業務部', '業務助理', '業務專員', '北區業務', '儲備業務', '客服業務'])) return 'WBU / 業務部';
    return 'WBU';
  }

  if (hasAny(keywordText, ['新華'])) {
    if (hasAny(keywordText, ['工程文件部', '工程文件', '文件組', '文件專員'])) {
      return '新華 / 工程 / 文件部 / 文件組';
    }
    if (hasAny(keywordText, ['業務三部', '客服業務'])) return '新華 / 業務三部';
    if (hasAny(keywordText, ['RF工程組'])) return '新華 / RF工程組';
    if (hasAny(keywordText, ['EMC工程組'])) return '新華 / EMC工程組';
    if (hasAny(keywordText, ['案件專員', 'PM'])) return '新華 / PM';
    if (hasAny(keywordText, ['業務部', '助理業務', '業務助理'])) return '新華 / 業務部';
    return '新華';
  }

  if (hasAny(keywordText, ['新竹'])) {
    if (hasAny(keywordText, ['工程部', '測試工程師', '工程師'])) return '新竹 / 工程部';
    if (hasAny(keywordText, ['業務部', '助理業務', '業務助理'])) return '新竹 / 業務部';
    return '新竹';
  }

  if (hasAny(keywordText, ['安規'])) {
    if (hasAny(keywordText, ['電池'])) return '安規';
    if (hasAny(keywordText, ['業務部', '助理業務', '業務助理'])) return '安規 / 安規業務部';
    return '安規';
  }

  if (hasAny(keywordText, ['零件'])) {
    if (hasAny(keywordText, ['製造部'])) return '零件 / 製造部';
    if (hasAny(keywordText, ['品保部'])) return '零件 / 品保部';
    if (hasAny(keywordText, ['業務部'])) return '零件 / 業務部';
    return '零件';
  }

  if (hasAny(keywordText, ['董事長室'])) return '行政 / 董事長室';
  if (hasAny(keywordText, ['財務部'])) return '行政 / 財務部';
  if (hasAny(keywordText, ['資訊部', 'MIS', 'ERP', 'AI開發', '軟體工程師'])) return '行政 / 資訊部';
  if (hasAny(keywordText, ['品管部', '品管人員', '品管工程師', '驗證人員'])) return '行政 / 品管部';
  if (hasAny(keywordText, ['行政'])) return '行政';

  if (hasAny(keywordText, ['北區業務', '儲備業務'])) return 'WBU / 業務部';

  return String(rawDepartment || '').trim() || null;
}

export function canonicalizeOnboardingPosition(rawPosition, context = {}) {
  const rawPositionText = String(rawPosition || '').trim();
  const keywordText = buildKeywordText(context.rawDepartment || context.department, rawPosition, context.emailSubject);
  const canonicalDepartment = canonicalizeOnboardingDepartment(context.department || context.rawDepartment, {
    ...context,
    rawPosition,
  });

  if (canonicalDepartment === 'ICC / 技術支援部') return '案件專員';
  if (canonicalDepartment === 'ICC / 工程部') return '測試工程師';
  if (canonicalDepartment === 'ICC / 業務部') return '客服業務';

  if (canonicalDepartment === 'WBU / PM') return 'PM';
  if (canonicalDepartment === 'WBU / 國際認證一部') return '認證專員';
  if (canonicalDepartment === 'WBU / 業務部') {
    if (hasAny(keywordText, ['客服業務'])) return '客服業務';
    if (hasAny(keywordText, ['業務助理'])) return '業務助理';
    if (hasAny(keywordText, ['業務專員', '助理業務', '北區業務', '儲備業務'])) return '業務專員';
  }
  if (canonicalDepartment === 'WBU / RF工程一部') {
    if (hasAny(keywordText, ['美國子公司外派工程師'])) return '美國子公司外派工程師';
    if (hasAny(keywordText, ['文件專員假日班', '文件專員假日'])) return '文件專員(假日班)';
    if (hasAny(keywordText, ['文件專員'])) return '文件專員';
    if (hasAny(keywordText, ['工程助理'])) return '工程助理';
    if (hasAny(keywordText, ['實習工程師', '測試工程師', '工程師'])) return '測試工程師';
  }
  if (canonicalDepartment === 'WBU / SAR工程部') {
    if (hasAny(keywordText, ['工程助理'])) return '工程助理';
    if (hasAny(keywordText, ['文件專員', 'SAR文件'])) return '文件專員';
    if (hasAny(keywordText, ['測試工程師', 'SAR工程師', '工程師'])) return '測試工程師';
  }
  if (canonicalDepartment === 'WBU / 場測工程部') return '測試工程師';

  if (canonicalDepartment === '新華 / 業務三部') return '客服業務';
  if (canonicalDepartment === '新華 / 工程 / 文件部 / 文件組') return '文件專員';
  if (canonicalDepartment === '新華 / RF工程組') return '測試工程師';
  if (canonicalDepartment === '新華 / EMC工程組') return '測試工程師';
  if (canonicalDepartment === '新華 / 業務部') return '助理業務/業務';
  if (canonicalDepartment === '新華 / PM') return 'PM';

  if (canonicalDepartment === '新竹 / 工程部') return '測試工程師(RF/EMC)';
  if (canonicalDepartment === '新竹 / 業務部') return '助理業務/業務';

  if (canonicalDepartment === '安規 / 安規業務部') {
    if (hasAny(keywordText, ['業務助理'])) return '業務助理(David)';
    if (hasAny(keywordText, ['助理業務', '業務'])) return '助理業務/業務';
  }
  if (canonicalDepartment === '安規' && hasAny(keywordText, ['電池', '工程師'])) return '電池案件工程師';

  if (canonicalDepartment === '行政 / 董事長室') return '行政專員';
  if (canonicalDepartment === '行政 / 財務部') {
    if (hasAny(keywordText, ['出納', '職務代理', '職代'])) return '出納短期職代';
    if (hasAny(keywordText, ['副理'])) return '副理';
    if (hasAny(keywordText, ['主任'])) return '主任';
  }
  if (canonicalDepartment === '行政 / 資訊部') {
    if (hasAny(keywordText, ['AI開發'])) return '軟體工程師(AI開發)';
    if (hasAny(keywordText, ['ERP', '開發維運'])) return '軟體工程師(ERP開發維運)';
    if (hasAny(keywordText, ['MIS'])) return 'MIS工程師';
  }
  if (canonicalDepartment === '行政 / 品管部') {
    if (hasAny(keywordText, ['驗證'])) return '驗證人員';
    if (hasAny(keywordText, ['品管'])) return '品管人員';
  }

  return rawPositionText || null;
}

export function canonicalizeOnboardingMatch(input = {}) {
  const emailSubject = String(input.emailSubject || input.email_subject || '').trim();
  const rawDepartment = String(input.department || input.rawDepartment || '').trim();
  const rawPosition = String(input.position || input.rawPosition || '').trim();

  const department = canonicalizeOnboardingDepartment(rawDepartment, {
    emailSubject,
    rawPosition,
  });
  const position = canonicalizeOnboardingPosition(rawPosition, {
    emailSubject,
    department,
    rawDepartment,
  });

  return {
    ...input,
    canonicalDepartment: department,
    canonicalPosition: position,
  };
}
