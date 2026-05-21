from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import Email
from app.rag.retriever import search_knowledge_base


def build_thread_context(email: Email) -> str:
    if not email.thread:
        return ""

    lines = []

    for item in email.thread.emails:
        lines.append(
            f"[{item.timestamp}] {item.sender} | {item.subject}\n{item.body}"
        )

    return "\n\n---\n\n".join(lines)


def build_rag_query(email: Email) -> str:
    combined = f"{email.subject} {email.body}".lower()

    if "gdpr" in combined or "article 20" in combined or "data portability" in combined:
        return "GDPR Article 20 data portability privacy legal 30 days escalation"

    if "sla" in combined or "rca" in combined or "downtime" in combined or "renewal on hold" in combined:
        return "SLA credit RCA P0 legal renewal Enterprise customer"

    if "refund" in combined or "cancel" in combined or "review" in combined or "trustpilot" in combined or "g2" in combined:
        return "refund public review churn retention escalation customer complaint"

    if "hipaa" in combined or "baa" in combined or "soc 2" in combined or "compliance" in combined:
        return "HIPAA BAA SOC 2 compliance data residency security questionnaire"

    if "api" in combined or "v2" in combined or "rate limit" in combined or "403" in combined:
        return "API v2 rate limits X-Workspace-ID migration deprecation"

    if "non-profit" in combined or "nonprofit" in combined or "pro-rata" in combined or "pricing" in combined or "discount" in combined:
        return "pricing nonprofit discount pro-rata billing standard plan"

    if "ransomware" in combined or "exfiltrated" in combined or "btc" in combined or "dark web" in combined:
        return "security incident ransomware data breach exfiltration no auto reply escalation"

    return f"{email.subject} {email.body}"


def score_sentiment(text: str) -> tuple[str, float]:
    lowered = text.lower()

    negative_terms = [
        "unhappy",
        "angry",
        "worst",
        "unacceptable",
        "no reply",
        "still no reply",
        "cancel",
        "cancelling",
        "legal",
        "breach",
        "inadequate",
        "not working",
        "broken",
        "failed",
        "failing",
        "crash",
        "error",
        "refund",
        "threat",
    ]

    positive_terms = [
        "love",
        "thanks",
        "resolved",
        "great",
        "happy",
        "proceed",
        "interested",
        "opportunity",
    ]

    negative_hits = sum(1 for term in negative_terms if term in lowered)
    positive_hits = sum(1 for term in positive_terms if term in lowered)

    raw_score = positive_hits - negative_hits

    if raw_score <= -3:
        return "Negative", -0.9

    if raw_score == -2:
        return "Negative", -0.7

    if raw_score == -1:
        return "Negative", -0.45

    if raw_score == 0:
        return "Neutral", 0.0

    if raw_score == 1:
        return "Positive", 0.45

    return "Positive", 0.75


def extract_entities(text: str) -> dict[str, list[str]]:
    import re

    order_ids = re.findall(r"(?:Order\s*#|order\s*#)(\d+)", text)
    ticket_ids = re.findall(r"(?:Ticket\s*#|PR\s*#)(\d+)", text)
    monetary_amounts = re.findall(r"\$[\d,]+(?:\.\d{2})?", text)
    deadlines = re.findall(
        r"\b(?:within\s+\d+\s+(?:hours?|days?)|Oct\s+\d+|October\s+\d+|Dec\s+\d+|December\s+\d+|EOD\s+\w+|next\s+\w+)\b",
        text,
        flags=re.IGNORECASE,
    )

    products_mentioned = []

    lowered = text.lower()
    for product in ["api", "dashboard", "chatbot", "csv bulk upload", "webhook", "billing portal"]:
        if product in lowered:
            products_mentioned.append(product)

    return {
        "order_ids": order_ids,
        "ticket_ids": ticket_ids,
        "monetary_amounts": monetary_amounts,
        "deadlines": deadlines,
        "products_mentioned": products_mentioned,
    }


def fallback_structured_classification(email: Email, rag_results: list[dict]) -> dict[str, Any]:
    text = f"{email.subject} {email.body}"
    lowered = text.lower()

    sentiment, sentiment_score = score_sentiment(text)

    category = email.category
    urgency = email.urgency
    requires_human = email.requires_human
    escalation_reason = None
    suggested_reply = None
    confidence = 0.82

    if email.heuristic_flags.get("spam_flag"):
        category = "Spam"
        urgency = "Low"
        requires_human = False
        confidence = 0.95
        suggested_reply = None

    elif email.heuristic_flags.get("internal_flag"):
        category = "Internal"
        urgency = "Low"
        requires_human = False
        confidence = 0.92
        suggested_reply = None

    elif email.heuristic_flags.get("security_flag"):
        category = "Legal" if email.heuristic_flags.get("legal_flag") else "Other"
        urgency = "Critical"
        requires_human = True
        escalation_reason = "Potential security incident detected; auto-reply is not allowed."
        confidence = 0.96

    elif "gdpr" in lowered or "article 20" in lowered or "data portability" in lowered:
        category = "Legal"
        urgency = "Critical"
        requires_human = True
        escalation_reason = "Formal GDPR/privacy request requires legal or privacy team handling."
        confidence = 0.97

    elif "cease and desist" in lowered or "legal team" in lowered or "legal action" in lowered:
        category = "Legal"
        urgency = "Critical"
        requires_human = True
        escalation_reason = "Legal threat or legal review mentioned."
        confidence = 0.96

    elif "hipaa" in lowered or "baa" in lowered or "soc 2" in lowered or "iso 27001" in lowered:
        category = "Compliance"
        urgency = "High" if "urgent" in lowered or "deadline" in lowered or "thursday" in lowered else "Medium"
        requires_human = True
        escalation_reason = "Compliance documentation requires specialist review."
        confidence = 0.9

    elif "refund" in lowered or "cancel" in lowered or "trustpilot" in lowered or "g2" in lowered or "public review" in lowered:
        category = "Complaint"
        urgency = "High" if "next hour" in lowered or "public" in lowered or "review" in lowered else "Medium"
        requires_human = True
        escalation_reason = "Customer complaint/refund/churn risk requires human review."
        confidence = 0.88

    elif "crash" in lowered or "server error" in lowered or "failing silently" in lowered or "data missing" in lowered:
        category = "Bug Report"
        urgency = "High"
        requires_human = True
        escalation_reason = "Technical issue may affect customer workflow or data integrity."
        confidence = 0.86

    elif "pricing" in lowered or "discount" in lowered or "pro-rata" in lowered or "non-profit" in lowered:
        category = "Inquiry"
        urgency = "Medium"
        requires_human = False
        confidence = 0.84
        suggested_reply = "Thanks for reaching out. Based on our pricing policy, we can help clarify discount eligibility and pro-rata billing."

    elif "feature request" in lowered or "roadmap" in lowered or "dark mode" in lowered or "ios app" in lowered:
        category = "Feature Request"
        urgency = "Low"
        requires_human = False
        confidence = 0.84
        suggested_reply = "Thanks for the suggestion. We have noted this feature request for product review."

    if confidence < 0.70:
        requires_human = True
        escalation_reason = "Classification confidence is below review threshold."

    policy_refs = [result["source_doc"] for result in rag_results]

    if not suggested_reply and not requires_human and category not in {"Spam", "Internal"}:
        suggested_reply = "Thanks for contacting support. We have received your message and will follow up with the appropriate information."

    return {
        "category": category,
        "sentiment": sentiment,
        "sentiment_score": sentiment_score,
        "urgency": urgency,
        "requires_human": requires_human,
        "escalation_reason": escalation_reason,
        "suggested_reply": suggested_reply,
        "confidence": confidence,
        "detected_entities": extract_entities(text),
        "policy_refs": policy_refs,
        "rag_context": rag_results,
        "model_used": "deterministic-fallback-v1",
    }


def classify_email(
    db: Session,
    email_id: int,
) -> dict[str, Any]:
    email = db.query(Email).filter(Email.id == email_id).first()

    if not email:
        raise AppError(
            status_code=404,
            error_code="EMAIL_NOT_FOUND",
            message="No email found for this id.",
            details={"email_id": email_id},
        )

    rag_query = build_rag_query(email)
    rag_results = search_knowledge_base(db=db, query=rag_query, top_k=3)

    classification = fallback_structured_classification(
        email=email,
        rag_results=rag_results,
    )

    email.category = classification["category"]
    email.sentiment_score = classification["sentiment_score"]
    email.urgency = classification["urgency"]
    email.requires_human = classification["requires_human"]
    email.confidence = classification["confidence"]
    email.raw_entities = classification["detected_entities"]

    if email.category in {"Spam", "Internal"}:
        email.status = "Ignored"
    elif email.requires_human or email.urgency == "Critical":
        email.status = "Escalated"
        if email.thread:
            email.thread.status = "Escalated"
    else:
        email.status = "Processing"

    db.commit()
    db.refresh(email)

    return {
        "email_id": email.id,
        "message_id": email.message_id,
        "thread_id": email.thread.thread_id if email.thread else None,
        "classification": classification,
        "updated_status": email.status,
    }


def classify_batch(
    db: Session,
    limit: int = 20,
) -> dict[str, Any]:
    emails = (
        db.query(Email)
        .filter(Email.confidence.is_(None))
        .order_by(Email.priority_score.desc(), Email.timestamp.asc())
        .limit(limit)
        .all()
    )

    results = []

    for email in emails:
        results.append(classify_email(db=db, email_id=email.id))

    return {
        "processed": len(results),
        "results": results,
    }