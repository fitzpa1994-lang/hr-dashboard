function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .trim();
}

function hasAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword));
}

export function canonicalizeOnboardingDepartment(rawDepartment, context = {}) {
  const departmentText = normalizeText(rawDepartment);
  const subjectText = normalizeText(context.emailSubject);
  const combined = `${departmentText} ${subjectText}`;

  if (hasAny(combined, ['五部'])) return '五部';
  if (hasAny(combined, ['新華'])) return '新華';
  if (hasAny(combined, ['新竹'])) return '新竹';
  if (hasAny(combined, ['ICC', '全球'])) return '全球';
  if (hasAny(combined, ['安規'])) return '安規';
  if (hasAny(combined, ['財務', '行政', '董事長室', '總公司'])) return '汐止/行政';

  return String(rawDepartment || '').trim() || null;
}

export function canonicalizeOnboardingPosition(rawPosition, context = {}) {
  const positionText = normalizeText(rawPosition);
  const subjectText = normalizeText(context.emailSubject);
  const departmentText = normalizeText(context.rawDepartment || context.department);
  const combined = `${subjectText} ${positionText} ${departmentText}`;
  const canonicalDepartment = canonicalizeOnboardingDepartment(context.department || context.rawDepartment, context);

  if (hasAny(combined, ['RFSAR', 'SAR工程師', 'SAR測試工程師'])) {
    return 'RF SAR 測試工程師';
  }

  if (departmentText.includes('SAR工程部') && hasAny(combined, ['工程師'])) {
    return 'RF SAR 測試工程師';
  }

  if (departmentText.includes('RF工程組') && hasAny(combined, ['工程師'])) {
    return 'RF SAR 測試工程師';
  }

  if (departmentText.includes('RF工程一部')) {
    if (hasAny(combined, ['實習工程師', '工程助理'])) return 'WE1工程助理(理工相關)';
    if (hasAny(combined, ['工程師', '場測'])) return 'WE1：場測工程師';
  }

  if (canonicalDepartment === '新竹' && hasAny(combined, ['EMC', '測試工程師', '工程師'])) {
    return '新竹測試工程師';
  }

  if (canonicalDepartment === '全球') {
    if (hasAny(combined, ['ICC測試工程師'])) return 'ICC 測試工程師';
    if (hasAny(combined, ['ICCPM'])) return 'ICC PM';
    if (hasAny(combined, ['客服業務'])) return 'ICC 客服業務';
  }

  if (canonicalDepartment === '五部') {
    if (hasAny(combined, ['業務助理'])) return '五部業務助理';
    if (hasAny(combined, ['認證專員'])) return '五部認證專員';
    if (hasAny(combined, ['RFPM'])) return '五部RF PM';
    if (hasAny(combined, ['WE1工程助理'])) return 'WE1工程助理(理工相關)';
    if (hasAny(combined, ['WE1', '場測工程師'])) return 'WE1：場測工程師';
    if (hasAny(combined, ['SAR文件'])) return 'SAR文件專員';
  }

  if (canonicalDepartment === '汐止/行政') {
    if (hasAny(combined, ['MIS'])) return 'MIS工程師';
    if (hasAny(combined, ['董事長室助理'])) return '董事長室助理';
    if (hasAny(combined, ['財務部'])) return '財務部副理/主任';
    if (hasAny(combined, ['軟體工程師'])) return '軟體工程師';
    if (hasAny(combined, ['品管工程師'])) return '品管工程師';
  }

  if (canonicalDepartment === '安規' && hasAny(combined, ['電池'])) {
    return '電池案件工程師';
  }

  return String(rawPosition || '').trim() || null;
}

export function canonicalizeOnboardingMatch(input = {}) {
  const emailSubject = String(input.emailSubject || input.email_subject || '').trim();
  const rawDepartment = String(input.department || input.rawDepartment || '').trim();
  const rawPosition = String(input.position || input.rawPosition || '').trim();

  const department = canonicalizeOnboardingDepartment(rawDepartment, { emailSubject });
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
