"""The structured report the agent returns."""

from typing import Literal

from pydantic import BaseModel, Field

Verdict = Literal["confirmed", "contradicted", "inconclusive", "unclaimed", "not_probed"]
Layer = Literal["model", "integration", "data", "none"]


class ClaimVerdict(BaseModel):
    """One claimed capability compared with what was observed."""

    field: str = Field(description="Profile key, for example tool_calling or image_inputs.")
    claimed_langchain: str | None = Field(
        description="Value in the LangChain profile as text, or null if missing."
    )
    claimed_models_dev: str | None = Field(
        description="Value in models.dev as text, or null if missing."
    )
    observed: str = Field(
        description="What the probes or provider metadata showed, for example '3/3 pass'."
    )
    verdict: Verdict = Field(
        description=(
            "confirmed or contradicted only with evidence ids. inconclusive when trials "
            "disagree or errored. unclaimed when no source states a value. not_probed "
            "when no probe was run, with the reason in note."
        )
    )
    layer: Layer = Field(
        description=(
            "Where a problem lives: model (the model cannot do it), integration "
            "(LangChain does not pass it through), data (the profile or models.dev "
            "record is wrong or missing), none when the claim holds."
        )
    )
    evidence_ids: list[str] = Field(description="Ids returned by probes, metadata or search.")
    note: str = Field(description="One or two plain sentences explaining the verdict.")


class ProfileReport(BaseModel):
    """Final answer of an investigation."""

    provider: str
    model: str
    integration_version: str = Field(description="Package and version, from get_claims.")
    scope_note: str = Field(
        description="Which models were in scope for this run and why others were not."
    )
    claims: list[ClaimVerdict]
    draft_change_id: str | None = Field(
        description="Id from draft_models_dev_change if a draft was approved, else null."
    )
    unverified: list[str] = Field(
        description="Anything that could not be checked, each with the reason."
    )
    summary: str = Field(description="Three sentences at most, plain language.")


class CostUsed(BaseModel):
    """Filled in by the app from budget counters, never by the model."""

    model_calls: int
    provider_calls_today: int
    tokens: int
    seconds: float
