function parseGoogleSheetsUrl(sheetUrl) {
  try {
    const url = new URL(sheetUrl);
    if (!url.hostname.includes("docs.google.com")) {
      throw new Error("URL must be a Google Sheets link.");
    }

    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) {
      throw new Error("Could not find a Google Sheets spreadsheet ID in the URL.");
    }

    return {
      spreadsheetId: match[1],
      gid: url.searchParams.get("gid") || "0",
    };
  } catch (error) {
    throw new Error(error.message || "Invalid Google Sheets URL.");
  }
}

export function toGoogleSheetsCsvExportUrl(sheetUrl) {
  const { spreadsheetId, gid } = parseGoogleSheetsUrl(sheetUrl);
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export function supportsGoogleSheetsImport(formatId) {
  return (
    formatId === "flat-component-export" ||
    formatId === "normalized-workbook-pair" ||
    formatId === "soft1-recipe-sheet"
  );
}
