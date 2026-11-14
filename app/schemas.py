from datetime import datetime, timezone
from ipaddress import ip_address
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    timestamp: datetime
    user: str = Field(min_length=1, max_length=80, pattern=r"^[\w.@+\-]+$")
    source_ip: str
    country: str = Field(pattern=r"^[A-Z]{2}$")
    device: str = Field(min_length=1, max_length=100)
    outcome: Literal["success", "failed"]
    failure_count: int = Field(ge=0, le=10000)
    data_out_mb: float = Field(ge=0, le=1000000, allow_inf_nan=False)
    new_device: bool

    @field_validator("timestamp")
    @classmethod
    def utc_timestamp(cls, value):
        if value.tzinfo is None:
            raise ValueError("timestamp must include a timezone, for example 2026-11-14T09:00:00Z")
        return value.astimezone(timezone.utc)

    @field_validator("source_ip")
    @classmethod
    def valid_ip(cls, value):
        return str(ip_address(value))


class Triage(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: Literal["open", "investigating", "resolved"]
    note: str = Field(default="", max_length=2000)
