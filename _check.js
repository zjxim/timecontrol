const fs = require("fs");
const html = fs.readFileSync("D:/program/knowyourtime/index.html", "utf8");
console.log("Micro-modal OK:", html.includes('<div id="micro-modal"'));
console.log("Note-modal OK:", html.includes('<div id="note-modal"'));

const http = require("http");
http.get("http://localhost:8080/", (res) => {
  let d = "";
  res.on("data", c => d += c);
  res.on("end", () => {
    console.log("Server: " + res.statusCode);
    const viaServer = d.includes('<div id="micro-modal"');
    console.log("Server micro-modal OK:", viaServer);
    process.exit(0);
  });
}).on("error", () => {
  console.log("Server not responding");
  process.exit(1);
});
