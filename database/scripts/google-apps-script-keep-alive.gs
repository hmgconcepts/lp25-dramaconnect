// DramaConnect optional Google Apps Script heartbeat.
// Set script properties SUPABASE_URL and SUPABASE_ANON_KEY before running.
function dramaConnectHeartbeat() {
  const properties = PropertiesService.getScriptProperties();
  const url = properties.getProperty('SUPABASE_URL');
  const anonKey = properties.getProperty('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY in Script Properties.');

  const response = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/dc_keep_alive', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + anonKey
    },
    payload: JSON.stringify({ p_source: 'apps-script' }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  let payload;
  try { payload = JSON.parse(response.getContentText()); } catch (error) { payload = null; }
  if (status < 200 || status >= 300 || !payload || payload.ok !== true) {
    throw new Error('DramaConnect heartbeat failed with HTTP ' + status + '.');
  }
  console.log('Heartbeat accepted: ' + payload.status + ' at ' + payload.at);
}

// Run once manually to replace the existing trigger with one daily trigger.
function installDramaConnectHeartbeatTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'dramaConnectHeartbeat')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('dramaConnectHeartbeat').timeBased().everyDays(1).atHour(8).create();
}
