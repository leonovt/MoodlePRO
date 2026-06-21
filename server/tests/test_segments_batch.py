from app.api import internal as api_internal


async def test_segments_batch_publishes_each_in_order(client, internal_headers, monkeypatch):
    """The batched endpoint must publish every segment to the job's channel, in order, so
    the browser WebSocket sees the same stream it did with one-POST-per-segment."""
    published = []

    async def spy_publish(redis, job_id, text, start, end):
        published.append((job_id, text, start, end))

    monkeypatch.setattr(api_internal, "publish_segment", spy_publish)

    segments = [{"text": f"s{i}", "start": float(i), "end": float(i) + 1} for i in range(3)]
    resp = await client.post(
        "/internal/jobs/job-batch/segments/batch",
        json={"segments": segments},
        headers=internal_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "count": 3}
    assert published == [
        ("job-batch", "s0", 0.0, 1.0),
        ("job-batch", "s1", 1.0, 2.0),
        ("job-batch", "s2", 2.0, 3.0),
    ]


async def test_segments_batch_requires_internal_token(client):
    resp = await client.post(
        "/internal/jobs/job-x/segments/batch",
        json={"segments": [{"text": "x", "start": 0.0, "end": 1.0}]},
    )
    assert resp.status_code in (401, 403)
