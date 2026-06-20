from redis_queue import WORKER_HEARTBEAT_KEY, publish_heartbeat


async def test_publish_heartbeat_sets_key_with_ttl(fake_redis):
    await publish_heartbeat(fake_redis, ttl_seconds=30)

    assert await fake_redis.exists(WORKER_HEARTBEAT_KEY)
    ttl = await fake_redis.ttl(WORKER_HEARTBEAT_KEY)
    assert 0 < ttl <= 30


async def test_heartbeat_key_matches_server_expectation(fake_redis):
    """The worker's heartbeat key must be the exact one the server's liveness check reads."""
    from app.services.queue import WORKER_HEARTBEAT_KEY as SERVER_KEY
    from app.services.queue import worker_is_alive

    assert WORKER_HEARTBEAT_KEY == SERVER_KEY
    await fake_redis.delete(WORKER_HEARTBEAT_KEY)  # fakeredis shares state across tests by URL
    assert await worker_is_alive(fake_redis) is False
    await publish_heartbeat(fake_redis, ttl_seconds=30)
    assert await worker_is_alive(fake_redis) is True
