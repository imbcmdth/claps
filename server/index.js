const express = require('express');
const { resolve } = require('path');
const app = express();

const clapBuffer = {};
const timeSorted = [];
const retainSeconds = 30;
const sampleRatio = 20;

app.use(express.json());
app.use('/', express.static(resolve(__dirname, '../client')));

const garbageCollectClaps = () => {
  const now = Date.now();
  let firstKeepIndex;
  for (let i = 0; i < timeSorted.length; i++) {
    if (now - timeSorted[i] < retainSeconds * 1000) {
      firstKeepIndex = i;
      break;
    }
  }

  let numberDeleted = 0;
  // Delete the old entries
  for (let i = 0; i < firstKeepIndex; i++) {
    numberDeleted += clapBuffer[timeSorted[i]];
    delete clapBuffer[timeSorted[i]];
  }
  timeSorted.splice(0, firstKeepIndex);
  if (numberDeleted > 0) {
    console.log(`Deleted ${numberDeleted} old claps.`);
  }
};

const addClap = (now) => {
  if (clapBuffer[now]) {
    clapBuffer[now]++;
  } else {
    clapBuffer[now] = 1;
    timeSorted.push(now);
  }
};

const getClaps = (startTime) => {
  let clapCount = 0;
  for (let i = 0; i < timeSorted.length; i++) {
    if (timeSorted[i] >= startTime) {
      clapCount += clapBuffer[timeSorted[i]];
    }
  }
  return clapCount;
};

app.post('/clap-on', (req, res) => {
  addClap(Date.now());
  res.send('ok');
});

app.get('/clap-off/:lastRequested?', (req, res) => {
  let startTime = +req.params.lastRequested;
  if (typeof startTime !== 'number') {
    startTime = Date.now() - 2000;
  }
  res.status(200).send({ numberOfClaps: sampleRatio * getClaps(startTime), requestedAt: Date.now() });
});

app.get('/debug', () => {
  console.log('timeSorted', timeSorted);
  console.log('clapBuffer', clapBuffer);
});

const server = app.listen(3000, () => {
  const host = server.address().address;
  const port = server.address().port;
  console.log(`Example app listening at http://${host}:${port}`);
});

const clapCollectionTimer = setInterval(garbageCollectClaps, 10000);
