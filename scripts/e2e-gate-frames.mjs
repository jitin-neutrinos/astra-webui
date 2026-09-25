import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8089 });

wss.on("connection", (ws) => {
  console.log("Client connected");
  
  // Wait a bit, then send a message start
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "message.start", payload: { id: "m1", role: "assistant" } }));
    
    // Then send the gate frame (via clarify)
    setTimeout(() => {
      const gatePayload = JSON.stringify({
        v: 1,
        gate_id: "plan-1",
        version: 1,
        title: "Test Plan",
        kind: "plan",
        actions: [{ id: "approve", label: "Approve", tone: "primary" }],
        body: { format: "markdown", content: "This is a test plan." }
      });
      
      ws.send(JSON.stringify({
        type: "clarify",
        payload: {
          params: {
            question: "I have a plan for you.\n<!--astra-gate/1\n" + gatePayload + "\n-->"
          },
          id: "req-1"
        }
      }));
    }, 100);
  }, 500);

  ws.on("message", (msg) => {
    console.log("Received:", msg.toString());
    try {
      const payload = JSON.parse(msg.toString());
      if (payload.type === "server.response") {
        console.log("Got gate response:", payload.payload.result.answer);
        setTimeout(() => process.exit(0), 100);
      }
    } catch (e) {}
  });
});

console.log("Mock WS server running on port 8089");
