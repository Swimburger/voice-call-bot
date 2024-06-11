import express from 'express';
import twilio from 'twilio';
const { VoiceResponse } = twilio.twiml;
import OpenAI from 'openai';
import { AssemblyAI } from 'assemblyai';
// Load environment variables from .env file
import 'dotenv/config';

// configuration
// Choose a port to run the server on
const PORT = 4000;
// Choose a chat completions model from OpenAI
const GPT_MODEL = "gpt-3.5-turbo";
// Replace with your own ngrok URL
const PUBLIC_URL = "https://feee-91-209-212-43.ngrok-free.app";

const app = express();
app.use(express.urlencoded({ extended: false }));

const openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assemblyAiClient = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const chatHistories = {};
const systemMessage = {
  role: "system",
  content: `You're a voice call assistant for the policical party called 'Robots Forward'.
  Answer only questions related to voting for US elections. Please start the conversation.`
};
const initializeChatHistory = (callSid) => {
  chatHistories[callSid] = [systemMessage];
}

// get chat history, but make sure it's a copy of the original array
// so the original array cannot be modified
const getChatHistory = (callSid) => chatHistories[callSid].slice();

const updateChatHistory = (callSid, messages) => {
  chatHistories[callSid] = messages;
}

// Define the route for incoming voice calls
app.post('/voice', (req, res) => {
  const callSid = req.body.CallSid;

  const twiml = new VoiceResponse();
  twiml.redirect('/enqueue');
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());

  // run the code asynchronously to avoid Twilio webhook timeouts
  (async () => {
    initializeChatHistory(callSid);
    const messages = getChatHistory(callSid);
    const response = await generateResponse(messages);
    messages.push({ role: "system", content: response });
    updateChatHistory(callSid, messages);
    await sendResponseToCall(callSid, response);
  })();
});

app.post('/wait', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.pause({ length: 1 });
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.post('/enqueue', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.enqueue(
    {
      waitUrl: '/wait'
    },
    "wait-for-assistant-queue"
  );
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.post('/record-action', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say('Formulating an answer, please hold.');
  twiml.redirect('/enqueue');
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.post('/recording', (req, res) => {
  const callSid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;
  res.status(200).end();

  // run the code asynchronously to avoid Twilio webhook timeouts
  (async () => {
    const transcript = await transcribeRecording(recordingUrl);
    const messages = getChatHistory(callSid);
    messages.push({ role: "user", content: transcript });
    const response = await generateResponse(messages);
    messages.push({ role: "system", content: response });
    updateChatHistory(callSid, messages);
    sendResponseToCall(callSid, response);
  })();
});

async function sendResponseToCall(callSid, response) {
  const twiml = new VoiceResponse();
  twiml.say(response);
  // Record the caller's speech and send the recording to a webhook endpoint for processing
  twiml.record({
    timeout: 5,
    transcribe: false, // Use AssemblyAI for transcription
    action: PUBLIC_URL + '/record-action',
    recordingStatusCallback: PUBLIC_URL + '/recording', // Specify the route to handle the recording
    recordingStatusCallbackEvent: ['completed'],
    recordingStatusCallbackMethod: 'POST',
  });

  await twilioClient.calls(callSid).update({ twiml: twiml.toString() });
}

async function transcribeRecording(recordingUrl) {
  const transcript = await assemblyAiClient.transcripts.transcribe({
    audio: recordingUrl
  });
  return transcript.text;
}

async function generateResponse(messages) {
  const completion = await openAiClient.chat.completions.create({
    model: GPT_MODEL,
    messages: messages,
  });
  const response = completion.choices[0].message.content;
  // add new messages to the original array
  return response;
}

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
