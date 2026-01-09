#!/usr/bin/env python3
"""
Simple WebSocket test script
Tests connection to the WebSocket endpoint
"""

import asyncio
import websockets
import json

async def test_websocket():
    # Test project ID
    project_id = "test-project-123"
    uri = f"ws://localhost:8000/api/v1/ws/projects/{project_id}"

    print(f"Connecting to {uri}...")

    try:
        async with websockets.connect(uri) as websocket:
            print("✅ Connected successfully!")

            # Send ping
            ping_message = json.dumps({"command": "ping"})
            await websocket.send(ping_message)
            print(f"📤 Sent: {ping_message}")

            # Wait for response
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print(f"📥 Received: {response}")

                # Parse response
                message = json.loads(response)
                if message.get("event") == "pong":
                    print("✅ Ping/Pong successful!")
                else:
                    print(f"📨 Got message: {message.get('event')}")

            except asyncio.TimeoutError:
                print("⏱️ No response within timeout (this is OK if no events are happening)")

            print("\n✅ WebSocket test completed successfully!")

    except websockets.exceptions.InvalidStatusCode as e:
        print(f"❌ Connection failed with status code: {e.status_code}")
        print(f"   This might mean the endpoint doesn't exist or has an error")
    except ConnectionRefusedError:
        print(f"❌ Connection refused - is the backend running?")
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket())
