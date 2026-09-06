/**
 * Business Day Time Calculation Utility for MelbunPOS
 * Computes exact start and end ISO timestamps according to store business day start hour cutoff (default: 6:00 AM IST).
 */

export interface BusinessDayRange {
  startIso: string;
  endIso: string;
  label: string;
  businessDate: string; // YYYY-MM-DD
}

/**
 * Calculates dynamic timezone offset in milliseconds for any IANA timezone using Intl.DateTimeFormat.formatToParts.
 * Strips sub-second jitter by rounding to nearest minute.
 * Defaults safely to IST (+05:30) if calculation fails.
 */
export function getTimezoneOffsetMs(timeZone: string = 'Asia/Kolkata', targetDate: Date = new Date()): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(targetDate);
    const map: Record<string, number> = {};
    parts.forEach(p => { if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10); });
    const tzDateAsUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour === 24 ? 0 : map.hour, map.minute, map.second);
    return Math.round((tzDateAsUtc - targetDate.getTime()) / 60000) * 60000;
  } catch (err) {
    return 5.5 * 60 * 60 * 1000;
  }
}

export function getBusinessDayCutoff(
  now: Date = new Date(),
  startHour: number = 6,
  timezone: string = 'Asia/Kolkata'
): { start: Date; end: Date; businessDateString: string } {
  // Format parts in target timezone (Asia/Kolkata)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  const localYear = getPart('year');
  const localMonth = getPart('month') - 1; // 0-indexed
  const localDay = getPart('day');
  const localHour = getPart('hour');

  // If local hour is before startHour (e.g. 02:00 AM before 06:00 AM),
  // this transaction / current time belongs to the PREVIOUS calendar day's business shift
  const baseDate = new Date(Date.UTC(localYear, localMonth, localDay));
  if (localHour < startHour) {
    baseDate.setUTCDate(baseDate.getUTCDate() - 1);
  }

  const bYear = baseDate.getUTCFullYear();
  const bMonth = baseDate.getUTCMonth();
  const bDay = baseDate.getUTCDate();

  const tzOffsetMs = getTimezoneOffsetMs(timezone, now);
  
  const startUtcMs = Date.UTC(bYear, bMonth, bDay, startHour, 0, 0, 0) - tzOffsetMs;
  const endUtcMs = Date.UTC(bYear, bMonth, bDay + 1, startHour, 0, 0, 0) - tzOffsetMs - 1;

  const businessDateString = `${bYear}-${String(bMonth + 1).padStart(2, '0')}-${String(bDay).padStart(2, '0')}`;

  return {
    start: new Date(startUtcMs),
    end: new Date(endUtcMs),
    businessDateString
  };
}

export type ReportPeriodPreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'custom';

export function getReportDateRange(
  preset: ReportPeriodPreset,
  startHour: number = 6,
  customFrom?: string, // YYYY-MM-DD
  customTo?: string,   // YYYY-MM-DD
  timezone: string = 'Asia/Kolkata'
): { startIso: string; endIso: string; displayLabel: string; fromDateStr: string; toDateStr: string } {
  const now = new Date();
  const tzOffsetMs = getTimezoneOffsetMs(timezone, now);
  const todayCutoff = getBusinessDayCutoff(now, startHour, timezone);

  const [tY, tM, tD] = todayCutoff.businessDateString.split('-').map(Number);
  const baseToday = new Date(Date.UTC(tY, tM - 1, tD));

  const formatDisplay = (d: Date) => {
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
    const year = d.getUTCFullYear();
    return `${day} ${month} ${year}`;
  };

  const toInputDate = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (preset === 'today') {
    const startMs = Date.UTC(tY, tM - 1, tD, startHour, 0, 0, 0) - tzOffsetMs;
    const endMs = Date.UTC(tY, tM - 1, tD + 1, startHour, 0, 0, 0) - tzOffsetMs - 1;
    const label = formatDisplay(baseToday);
    const dateStr = toInputDate(baseToday);
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      displayLabel: `${label} - ${label}`,
      fromDateStr: dateStr,
      toDateStr: dateStr
    };
  }

  if (preset === 'yesterday') {
    const yDate = new Date(Date.UTC(tY, tM - 1, tD - 1));
    const yY = yDate.getUTCFullYear();
    const yM = yDate.getUTCMonth();
    const yD = yDate.getUTCDate();

    const startMs = Date.UTC(yY, yM, yD, startHour, 0, 0, 0) - tzOffsetMs;
    const endMs = Date.UTC(yY, yM, yD + 1, startHour, 0, 0, 0) - tzOffsetMs - 1;
    const label = formatDisplay(yDate);
    const dateStr = toInputDate(yDate);
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      displayLabel: `${label} - ${label}`,
      fromDateStr: dateStr,
      toDateStr: dateStr
    };
  }

  if (preset === 'this_week') {
    // Start of week (Monday)
    const dayOfWeek = baseToday.getUTCDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(Date.UTC(tY, tM - 1, tD - diffToMonday));
    const mY = monday.getUTCFullYear();
    const mM = monday.getUTCMonth();
    const mD = monday.getUTCDate();

    const startMs = Date.UTC(mY, mM, mD, startHour, 0, 0, 0) - tzOffsetMs;
    const endMs = Date.UTC(tY, tM - 1, tD + 1, startHour, 0, 0, 0) - tzOffsetMs - 1;

    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      displayLabel: `${formatDisplay(monday)} - ${formatDisplay(baseToday)}`,
      fromDateStr: toInputDate(monday),
      toDateStr: toInputDate(baseToday)
    };
  }

  if (preset === 'this_month') {
    // 1st of current month
    const firstDay = new Date(Date.UTC(tY, tM - 1, 1));
    const startMs = Date.UTC(tY, tM - 1, 1, startHour, 0, 0, 0) - tzOffsetMs;
    const endMs = Date.UTC(tY, tM - 1, tD + 1, startHour, 0, 0, 0) - tzOffsetMs - 1;

    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      displayLabel: `${formatDisplay(firstDay)} - ${formatDisplay(baseToday)}`,
      fromDateStr: toInputDate(firstDay),
      toDateStr: toInputDate(baseToday)
    };
  }

  if (preset === 'this_year') {
    // 1st Jan of current year
    const jan1 = new Date(Date.UTC(tY, 0, 1));
    const startMs = Date.UTC(tY, 0, 1, startHour, 0, 0, 0) - tzOffsetMs;
    const endMs = Date.UTC(tY, tM - 1, tD + 1, startHour, 0, 0, 0) - tzOffsetMs - 1;

    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      displayLabel: `${formatDisplay(jan1)} - ${formatDisplay(baseToday)}`,
      fromDateStr: toInputDate(jan1),
      toDateStr: toInputDate(baseToday)
    };
  }

  // Custom (Bugs #11 & #161)
  if (preset === 'custom') {
    if (customFrom && customTo) {
      const [fY, fM, fD] = customFrom.split('-').map(Number);
      const [tY2, tM2, tD2] = customTo.split('-').map(Number);

      const fromDate = new Date(Date.UTC(fY, fM - 1, fD));
      const toDate = new Date(Date.UTC(tY2, tM2 - 1, tD2));

      const startMs = Date.UTC(fY, fM - 1, fD, startHour, 0, 0, 0) - tzOffsetMs;
      const endMs = Date.UTC(tY2, tM2 - 1, tD2 + 1, startHour, 0, 0, 0) - tzOffsetMs - 1;

      return {
        startIso: new Date(startMs).toISOString(),
        endIso: new Date(endMs).toISOString(),
        displayLabel: `${formatDisplay(fromDate)} - ${formatDisplay(toDate)}`,
        fromDateStr: customFrom,
        toDateStr: customTo
      };
    }

    return {
      startIso: '',
      endIso: '',
      displayLabel: 'Custom (Select Date Range)',
      fromDateStr: customFrom || '',
      toDateStr: customTo || ''
    };
  }

  // Default fallback to 'this_month'
  return getReportDateRange('this_month', startHour, undefined, undefined, timezone);
}
