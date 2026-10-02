"""Tests for Common Ground database models."""

from app.models import Legislation


def test_legislation_creation(test_db):
    """Test creating legislation."""
    leg = Legislation(
        id="test_bill_1",
        source="test",
        level="federal",
        bill_number="HR123",
        title="Test Bill",
        status="introduced"
    )

    test_db.add(leg)
    test_db.commit()

    retrieved = test_db.query(Legislation).filter(Legislation.id == "test_bill_1").first()
    assert retrieved is not None
    assert retrieved.bill_number == "HR123"


def test_legislation_defaults(test_db):
    """A bill with no analysis yet should come back unanalyzed, not half-set."""
    leg = Legislation(
        id="test_bill_2",
        source="test",
        level="local",
        bill_number="250001",
        title="Unanalyzed Bill",
        status="introduced",
    )
    test_db.add(leg)
    test_db.commit()

    retrieved = test_db.query(Legislation).filter(Legislation.id == "test_bill_2").first()
    assert retrieved.analyzed_at is None
    assert retrieved.headline is None
    assert retrieved.skip_reason is None
