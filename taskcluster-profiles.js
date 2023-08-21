// npm install fs.promises

/* HOW TO USE:
 1. download the task data using a command like:
     TASKCLUSTER_ROOT_URL="https://firefox-ci-tc.services.mozilla.com/"  <path to taskcluster binary>/taskcluster api queue listTaskGroup <task id of the Gecko Decision Task> > ./tasks.json

 2. Then load http://localhost:8181/tasks in the Firefox Profiler.
*/

const http = require('http');
const fsp = require('fs.promises');
const https = require('https');
const fs = require('fs');

const baseProfile = '{"meta":{"interval":1000,"startTime":0,"abi":"","misc":"","oscpu":"","platform":"","processType":0,"extensions":{"id":[],"name":[],"baseURL":[],"length":0},"categories":[{"name":"Other","color":"grey","subcategories":["Other"]}],"product":"Home power profiling","stackwalk":0,"toolkit":"","version":27,"preprocessedProfileVersion":47,"appBuildID":"","sourceURL":"","physicalCPUs":0,"logicalCPUs":0,"CPUName":"taskcluster","symbolicationNotSupported":true,"markerSchema":[]},"libs":[],"pages":[],"threads":[{"processType":"default","processStartupTime":0,"processShutdownTime":null,"registerTime":0,"unregisterTime":null,"pausedRanges":[],"name":"GeckoMain","isMainThread":true,"pid":"0","tid":0,"samples":{"weightType":"samples","weight":null,"eventDelay":[],"stack":[],"time":[],"length":0},"markers":{"data":[],"name":[],"startTime":[],"endTime":[],"phase":[],"category":[],"length":0},"stackTable":{"frame":[0],"prefix":[null],"category":[0],"subcategory":[0],"length":1},"frameTable":{"address":[-1],"inlineDepth":[0],"category":[null],"subcategory":[0],"func":[0],"nativeSymbol":[null],"innerWindowID":[0],"implementation":[null],"line":[null],"column":[null],"length":1},"funcTable":{"isJS":[false],"relevantForJS":[false],"name":[0],"resource":[-1],"fileName":[null],"lineNumber":[null],"columnNumber":[null],"length":1},"resourceTable":{"lib":[],"name":[],"host":[],"type":[],"length":0},"nativeSymbols":{"libIndex":[],"address":[],"name":[],"functionSize":[],"length":0}}],"counters":[]}';

function sendJSON(res, data, forceGC = false) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  let json = JSON.stringify(data);
  if (forceGC && global.gc) {
    data = null;
    global.gc();
  }
  res.end(json);
}

function sendError(res, error) {
  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain');
  res.end(error + '\n');
  console.log(error);
}

async function tasks(res) {
  try {
    let data = JSON.parse(await fsp.readFile('./tasks.json', { encoding: 'utf8' }));
    let tasks = data.tasks.map(t => ({
      name: t.task.metadata.name, start: new Date(t.status.runs[0].started).valueOf(), end: new Date(t.status.runs[0].resolved).valueOf()}));
    tasks.sort((ta, tb) => ta.start - tb.start);
    let startTime = Math.min(...tasks.map(t => t.start));
    let endTime = Math.max(...tasks.map(t=>t.end));

    let profile = JSON.parse(baseProfile);
    profile.meta.interval = 1;
    profile.meta.startTime = startTime;
    profile.meta.product = new Date(startTime).toLocaleDateString("fr-FR", {timeZone: "Europe/Paris"}) + " — Task cluster";
    profile.meta.physicalCPUs = tasks.length;
    profile.meta.CPUName = "Task cluster"
    profile.meta.markerSchema.push({
      name: "Task",
      tooltipLabel:"{marker.name} — {marker.data.job}",
      tableLabel:"{marker.name} — {marker.data.job}",
      chartLabel:"{marker.data.job}",
      display: ["marker-chart", "marker-table"],
      data: [
        {
          key: "startTime",
          label: "Start time",
          format: "string"
        },
        {
          key: "job",
          label: "Job name",
          format: "string"
        },
      ]
    });

    let times = [0, endTime - startTime];
    let zeros = new Array(times.length).fill(0);
    let firstThread = profile.threads[0];
    let threadSamples = firstThread.samples;
    threadSamples.eventDelay = zeros;
    threadSamples.stack = zeros;
    threadSamples.time = times;
    threadSamples.length = times.length;

    let markers = firstThread.markers;
    firstThread.stringArray = ["(root)"];

    function addMarker(name, startTime, endTime, job) {
      markers.category.push(0);
      markers.startTime.push(startTime);
      markers.endTime.push(endTime);
      // 1 = marker with start and end times, 2 = start but no end.
      markers.phase.push(endTime ? 1 : 2);
      let index = firstThread.stringArray.indexOf(name);
      if (index == -1) {
        firstThread.stringArray.push(name);
        index = firstThread.stringArray.length - 1;
      }
      markers.name.push(index);

      let niceStartTime = new Date(profile.meta.startTime + startTime).toLocaleTimeString("fr-FR", {timeZone: "Europe/Paris"});
      markers.data.push({
        type: "Task",
        startTime: niceStartTime,
        job
      });
      markers.length++;
    }

    for (let task of tasks) {
      let [name, job] = task.name.split("/");
      addMarker(name, task.start - startTime, task.end - startTime, job);
    }

    sendJSON(res, profile, true);
  } catch (err) {
    sendError(res, 'profile: ' + err);
  }
}


const app = (req, res) => {
  console.log(new Date(), req.url);

  if (req.url == "/tasks") {
    tasks(res);
    return;
  }

  fileServer.serve(req, res);
};

if (process.env.NODE_ENV == "production") {
  const server = http.createServer(app)
  server.listen(80, "0.0.0.0", () => {
    console.log("Production server running");
  });

  const sslOptions = {
    key: fs.readFileSync("./ssl.key"),
    cert: fs.readFileSync("./ssl.crt")
  };
  https.createServer(sslOptions, app)
       .listen(443);
} else {
  const server = http.createServer(app)
  server.listen(8181, "0.0.0.0", () => {
    console.log("Testing server running at port 8181");
  });
}
