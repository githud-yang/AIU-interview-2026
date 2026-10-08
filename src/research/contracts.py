"""Public workflow contracts; stage completion always refers to persisted output."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

STAGES = [
    ("literature", "文献发现"), ("reading", "全文获取与阅读"),
    ("ideation", "选题与反证"), ("protocol", "实验设计"),
    ("data", "数据准备"), ("baseline", "基线复现"),
    ("method", "方法实现"), ("experiments", "候选实验"),
    ("validation", "复验与消融"), ("manuscript", "分析与论文"),
    ("review", "核查与修改"), ("submission", "投稿材料"),
]


class Budget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Optional user choices. The workflow itself ends when its stages finish.
    max_seconds: int | None = Field(default=None, ge=60)
    model_calls: int | None = Field(default=None, ge=0)
    max_trials: int | None = Field(default=None, ge=3)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goal: str = Field(min_length=5, max_length=4000)
    domain: str = "digits_robustness"
    mode: str = "autonomous"
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    budget: Budget = Field(default_factory=Budget)


class ResumeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    initiator: Literal["user", "agent"] = "user"


class ResearchQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(max_length=180)
    hypothesis: str = Field(max_length=1200)
    motivation: str = Field(max_length=1600)
    research_query: str = Field(max_length=200)
    novelty_status: str = "unverified"
    limitations: list[str] = Field(default_factory=list, max_length=8)


class ResearchAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    interpretation: str = Field(max_length=5000)
    limitations: list[str] = Field(default_factory=list, max_length=12)
    follow_up: list[str] = Field(default_factory=list, max_length=8)


class ResearchReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issues: list[str] = Field(default_factory=list, max_length=12)
    verdict: str = Field(max_length=1200)


class ResearchCancelled(RuntimeError):
    pass


class ResearchBudgetExceeded(RuntimeError):
    pass
