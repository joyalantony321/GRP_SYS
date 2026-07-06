import sys, requests

payload = {
  "workOrderNumber": "9658",
  "companyCode": "GRP",
  "salesPerson": "Test User",
  "woDate": "2026-07-06",
  "companyName": "Test Company LLC",
  "brand": "PIPECO(Malaysia)",
  "items": [{"slNo": 1, "itemDescription": "Tank 10000L", "qty": "2", "remarks": ""}]
}

r = requests.post("http://127.0.0.1:8000/work-order/export", json=payload, timeout=90)
print("Status:", r.status_code)
print("Content-Type:", r.headers.get("Content-Type"))
print("Content-Length:", len(r.content), "bytes")
print("First bytes:", r.content[:5])
if r.status_code != 200:
    print("Error body:", r.text[:500])
elif r.content[:4] == b"%PDF":
    print("VALID PDF!")
else:
    print("NOT a PDF — first 200 bytes:", r.content[:200])
