// defaults/preferences/prefs.js
pref("extensions.aiSummarizer.provider", "openai"); // openai | gemini
pref("extensions.aiSummarizer.openaiApiKey", "");
pref("extensions.aiSummarizer.geminiApiKey", "");
pref("extensions.aiSummarizer.model", "gpt-4.1-mini");

pref("extensions.aiSummarizer.maxChars", 50000);

// Pacing between items (bulk runs)
pref("extensions.aiSummarizer.minDelayMs", 2500);

pref("extensions.aiSummarizer.maxRetries", 6);
pref("extensions.aiSummarizer.retryJitterMs", 400);

pref("extensions.aiSummarizer.promptTemplate",
"Summarize this paper for a researcher. Provide:\n" +
"1) 5-bullet key contributions\n" +
"2) Methods (concise)\n" +
"3) Main results\n" +
"4) Limitations\n" +
"5) 5 follow-up ideas\n" +
"Keep it factual and grounded in the paper.\n"
);

pref("extensions.aiSummarizer.saveAsChildNoteDefault", true);
pref("extensions.aiSummarizer.addTagOnSave", true);
pref("extensions.aiSummarizer.tagName", "Scholar");
pref("extensions.aiSummarizer.overwriteExistingNote", true);

