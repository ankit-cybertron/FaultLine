"""
Script to test all models available on the active Groq API key.
Queries the Groq API, lists all accessible models, asks a question to each,
and prints a status report of working vs non-working models.
"""

import os
import sys
import time
from pathlib import Path
from dotenv import dotenv_values
from groq import Groq

def main():
    repo_root = Path(__file__).resolve().parent.parent
    env_path = repo_root / ".env"
    
    # Load GROQ_API_KEY directly from .env to bypass any stale shell env vars
    env_vars = dotenv_values(env_path)
    api_key = env_vars.get("GROQ_API_KEY") or os.environ.get("GROQ_API_KEY")
    
    if not api_key:
        print("❌ Error: No GROQ_API_KEY found in .env or environment!")
        sys.exit(1)
        
    masked_key = api_key[:8] + "..." + api_key[-4:] if len(api_key) > 12 else "***"
    print(f"🔑 Using Groq API Key: {masked_key} (from {env_path})")
    
    client = Groq(api_key=api_key)
    
    print("\n📡 Fetching available models list from Groq API...")
    try:
        models_response = client.models.list()
        all_models = sorted([m.id for m in models_response.data])
    except Exception as e:
        print(f"❌ Failed to fetch models list: {e}")
        sys.exit(1)
        
    print(f"Found {len(all_models)} model(s) on your account:\n")
    for m in all_models:
        print(f"  • {m}")
        
    test_question = "What is the capital of France? Answer in 3 words or fewer."
    print(f"\n🧪 Testing models with prompt: '{test_question}'\n")
    print(f"{'MODEL ID':<40} | {'STATUS':<10} | {'LATENCY':<8} | {'RESPONSE / ERROR'}")
    print("-" * 95)
    
    working_models = []
    non_working_models = []
    
    for model_id in all_models:
        # Check for known audio/transcription models
        if "whisper" in model_id.lower():
            status = "SKIPPED"
            latency_str = "-"
            msg = "Audio-only transcription model (not chat/completion)"
            print(f"{model_id:<40} | {status:<10} | {latency_str:<8} | {msg}")
            non_working_models.append((model_id, msg))
            continue
            
        start_time = time.time()
        try:
            response = client.chat.completions.create(
                model=model_id,
                messages=[
                    {"role": "user", "content": test_question}
                ],
                max_tokens=50,
                temperature=0.0,
            )
            elapsed = time.time() - start_time
            latency_str = f"{elapsed:.2f}s"
            content = response.choices[0].message.content.strip().replace("\n", " ")
            status = "✅ OK"
            print(f"{model_id:<40} | {status:<10} | {latency_str:<8} | {content}")
            working_models.append((model_id, latency_str, content))
        except Exception as exc:
            elapsed = time.time() - start_time
            latency_str = f"{elapsed:.2f}s"
            status = "❌ FAIL"
            # Extract error message cleanly
            err_msg = str(exc)
            if hasattr(exc, "message"):
                err_msg = exc.message
            elif hasattr(exc, "body") and isinstance(exc.body, dict) and "message" in exc.body:
                err_msg = exc.body["message"]
            elif " - " in err_msg:
                err_msg = err_msg.split(" - ", 1)[-1]
            
            # Truncate error message if too long
            err_msg = err_msg.strip().replace("\n", " ")
            if len(err_msg) > 60:
                err_msg = err_msg[:57] + "..."
            print(f"{model_id:<40} | {status:<10} | {latency_str:<8} | {err_msg}")
            non_working_models.append((model_id, err_msg))
            
    print("\n" + "=" * 95)
    print("📊 SUMMARY")
    print("=" * 95)
    print(f"Total models inspected: {len(all_models)}")
    print(f"Working Chat Models:    {len(working_models)}")
    print(f"Non-working / Special:  {len(non_working_models)}")
    
    if working_models:
        print("\n✨ RECOMMENDED WORKING MODELS:")
        for m, lat, ans in working_models:
            print(f"  • {m:<35} (Latency: {lat}) -> Response: \"{ans}\"")

        # Test top general LLM candidates for JSON mode (required by FaultLine router)
        candidates = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]
        print("\n🔍 Testing JSON mode support on top candidates (FaultLine Agent Requirement):")
        for cand in candidates:
            try:
                t0 = time.time()
                res = client.chat.completions.create(
                    model=cand,
                    messages=[
                        {"role": "system", "content": "You are a JSON generator. Output strictly JSON."},
                        {"role": "user", "content": "Return a JSON object with keys: decision, reason"}
                    ],
                    response_format={"type": "json_object"},
                    max_tokens=60,
                    temperature=0.0
                )
                dt = time.time() - t0
                print(f"  ✅ {cand:<20} JSON Mode: OK ({dt:.2f}s) -> {res.choices[0].message.content.strip()}")
            except Exception as e:
                print(f"  ❌ {cand:<20} JSON Mode Failed: {e}")
    else:
        print("\n⚠️ No working chat models found on this key.")

if __name__ == "__main__":
    main()

