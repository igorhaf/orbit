const windowsToIana: Record<string, string> = {
  UTC: "UTC",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "SA Pacific Standard Time": "America/Bogota",
  "SA Western Standard Time": "America/La_Paz",
  "SA Eastern Standard Time": "America/Cayenne",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Montevideo Standard Time": "America/Montevideo",
  "Tokyo Standard Time": "Asia/Tokyo",
  "China Standard Time": "Asia/Shanghai",
  "India Standard Time": "Asia/Kolkata",
  "AUS Eastern Standard Time": "Australia/Sydney",
};
const ianaToWindows = Object.fromEntries(
  Object.entries(windowsToIana).map(([windows, iana]) => [iana, windows]),
);

export const orbitTimeZone = (microsoft?: string | null) => {
  if (!microsoft) return "UTC";
  if (windowsToIana[microsoft]) return windowsToIana[microsoft];
  try {
    new Intl.DateTimeFormat("en", { timeZone: microsoft }).format();
    return microsoft;
  } catch {
    return "UTC";
  }
};

export const microsoftTimeZone = (orbit?: string | null) =>
  !orbit ? "UTC" : ianaToWindows[orbit] || orbit;

const parts = (date: Date, timeZone: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

export const graphDateTime = (instant: string, timeZone?: string | null) => {
  const zone = orbitTimeZone(timeZone);
  const value = parts(new Date(instant), zone);
  return {
    dateTime: `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}`,
    timeZone: microsoftTimeZone(zone),
  };
};

export const graphLocalToDate = (
  dateTime: string,
  microsoftZone?: string | null,
  allDay = false,
) => {
  const date = dateTime.slice(0, 10);
  if (allDay) return new Date(`${date}T00:00:00.000Z`);
  if (/Z$|[+-]\d\d:\d\d$/.test(dateTime)) return new Date(dateTime);
  const zone = orbitTimeZone(microsoftZone);
  const values = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!values) return new Date(dateTime);
  const desired = Date.UTC(
    Number(values[1]),
    Number(values[2]) - 1,
    Number(values[3]),
    Number(values[4]),
    Number(values[5]),
    Number(values[6] || 0),
  );
  let result = desired;
  for (let index = 0; index < 2; index++) {
    const actual = parts(new Date(result), zone);
    const represented = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
      Number(actual.second),
    );
    result += desired - represented;
  }
  return new Date(result);
};
