"""AI Agent framework for debates."""

import logging
import json
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _extract_cited_sources(argument: str, research_sources: list) -> list:
    """Return only the sources actually cited inline in the argument text."""
    import re
    cited_indices = {int(m) - 1 for m in re.findall(r'\[(\d+)\]', argument)}
    return [
        {"title": s.get("title", ""), "url": s.get("url", ""),
         "snippet": s.get("snippet", "")[:300], "source_type": s.get("source_type", "web")}
        for i, s in enumerate(research_sources or [])
        if i in cited_indices and s.get("url")
    ]


class BaseDebateAgent(ABC):
    """Abstract base class for debate agents."""
    
    def __init__(self, agent_id: str, name: str, persona: str, system_prompt: str):
        self.agent_id = agent_id
        self.name = name
        self.persona = persona
        self.system_prompt = system_prompt
    
    @abstractmethod
    async def generate_argument(
        self,
        legislation_title: str,
        legislation_summary: str,
        position: str,
        previous_arguments: list[dict[str, str]] = None,
        turn_number: int = 1,
        research_sources: list[dict] = None,
        conviction_level: int = 3,
    ) -> dict:
        """Generate an argument about legislation."""
        pass

    @abstractmethod
    async def rate_argument(
        self,
        argument: str,
        context: str,
        criteria: list[str] = None
    ) -> dict:
        """Rate an argument from another agent."""
        pass

    @abstractmethod
    async def research_topic(self, topic: str, legislation_content: str = None) -> dict:
        """Research a topic before debating."""
        pass


class ClaudeDebateAgent(BaseDebateAgent):
    """Claude-powered debate agent."""
    
    def __init__(self, agent_id: str, name: str, persona: str, system_prompt: str):
        super().__init__(agent_id, name, persona, system_prompt)
        try:
            from anthropic import Anthropic
            self.client = Anthropic(api_key=settings.anthropic_api_key)
            self.model = settings.default_model
            self.temperature = settings.temperature
        except ImportError:
            logger.warning("Anthropic not available - Claude agent disabled")
            self.client = None
    
    async def research_topic(self, topic: str, legislation_content: str = None) -> dict:
        """Research topic using Claude."""
        if not self.client:
            return {"research": "Research unavailable - Claude not configured"}
        
        try:
            prompt = f"""You are {self.name}, a {self.persona}.

Research this legislation topic: {topic}

{f"Legislation content: {legislation_content}" if legislation_content else ""}

Provide:
1. Key facts and context
2. Historical background
3. Current status and implications
4. Potential arguments for and against
5. Relevant data or statistics

Be thorough but concise. Focus on factual information."""
            
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                system=self.system_prompt,
                temperature=0.3,  # Lower temperature for research
                messages=[{"role": "user", "content": prompt}]
            )
            
            return {
                "research": response.content[0].text,
                "source": "claude",
                "confidence": "high"
            }
        except Exception as e:
            logger.error(f"Research error: {e}")
            return {"research": f"Research failed: {e}", "source": "error"}
    
    async def generate_argument(
        self,
        legislation_title: str,
        legislation_summary: str,
        position: str,
        previous_arguments: list[dict[str, str]] = None,
        turn_number: int = 1,
        research_sources: list[dict] = None,
        conviction_level: int = 3,
        moderator_notes: list[str] = None,
    ) -> dict:
        """Generate an argument using Claude, grounded in research sources."""
        if not self.client:
            return {
                "agent_id": self.agent_id,
                "agent_name": self.name,
                "position": position,
                "argument": "AI service unavailable",
                "citations": [],
                "turn_number": turn_number,
            }

        try:
            # Build conversation history
            messages = []
            if previous_arguments:
                for arg in previous_arguments:
                    messages.append({
                        "role": "user",
                        "content": f"{arg.get('agent_name', 'Other Agent')}: {arg.get('argument', '')}"
                    })
                    messages.append({
                        "role": "assistant",
                        "content": "I acknowledge this argument."
                    })

            # Conviction modifier
            conviction_labels = {
                1: "balanced and fair, acknowledging valid points on multiple sides",
                2: "thoughtful and measured, leaning toward your expert perspective",
                3: "clear and direct, expressing your perspective with strong reasoning",
                4: "confident and assertive in your analysis",
                5: "forceful and uncompromising in your view",
            }
            conviction_instruction = conviction_labels.get(conviction_level, conviction_labels[3])

            # Format research sources
            sources_block = ""
            if research_sources:
                sources_block = "\n\nResearch sources available to you:\n"
                for i, src in enumerate(research_sources[:6], 1):
                    sources_block += f"{i}. {src.get('title', '')}\n"
                    if src.get('snippet'):
                        sources_block += f"   {src['snippet'][:200]}\n"
                    if src.get('url'):
                        sources_block += f"   URL: {src['url']}\n"

            citation_instruction = (
                "- Only cite a source inline [N] if the specific claim you are making is directly supported by that source's snippet shown above. Do not cite a source for a claim not found in its snippet.\n"
                if research_sources else ""
            )

            mod_notes_block = ""
            if moderator_notes:
                mod_notes_block = "\n\nRecent moderator corrections — take these into account:\n"
                for note in moderator_notes:
                    mod_notes_block += f"- {note}\n"

            prompt = f"""You are {self.name}, presenting as {self.persona}.

Bill: {legislation_title}
Summary: {legislation_summary}
{sources_block}
Turn {turn_number}: Give your response to this debate as {self.name}. Be {conviction_instruction}.

Requirements:
- Speak naturally in first person — like a real person in a debate, not a policy report
- If a previous speaker has made a claim, directly challenge their strongest specific point with evidence or reasoning before making your own points
- Make 2-3 strong supporting points grounded in your expertise
- Reference specific evidence or data where possible
{citation_instruction}- End with a pointed question for the other participants (if applicable)

Keep your response focused and under 300 words."""

            if mod_notes_block:
                messages.append({"role": "user", "content": mod_notes_block.strip()})
                messages.append({"role": "assistant", "content": "Understood. I'll take those corrections into account."})

            messages.append({"role": "user", "content": prompt})

            response = self.client.messages.create(
                model=self.model,
                max_tokens=1200,
                system=self.system_prompt,
                temperature=min(0.9, 0.5 + (conviction_level - 1) * 0.1),
                messages=messages,
            )

            argument = response.content[0].text

            return {
                "agent_id": self.agent_id,
                "agent_name": self.name,
                "position": position,
                "argument": argument,
                "citations": _extract_cited_sources(argument, research_sources),
                "turn_number": turn_number,
                "stop_reason": response.stop_reason,
            }

        except Exception as e:
            logger.error(f"Error generating argument for {self.name}: {e}")
            raise
    
    async def rate_argument(
        self,
        argument: str,
        context: str,
        criteria: list[str] = None
    ) -> dict:
        """Rate an argument using Claude."""
        if not self.client:
            return {"rater_agent_id": self.agent_id, "rating_data": {"error": "Claude unavailable"}}
        
        if not criteria:
            criteria = ["persuasiveness", "logical_soundness", "factual_accuracy", "relevance"]
        
        try:
            prompt = f"""You are {self.name}, an expert evaluator in policy debates.

Rate the following argument on a scale of 1-10 for each criterion.

Context: {context}

Argument to Rate:
{argument}

Evaluation Criteria: {', '.join(criteria)}

Provide:
1. Scores (1-10) for each criterion
2. Brief reasoning for each score
3. Overall assessment
4. Strengths of the argument
5. Weaknesses or gaps

Format your response as JSON with keys: "scores" (dict), "reasoning", "overall_assessment", "strengths", "weaknesses"
"""

            response = self.client.messages.create(
                model=self.model,
                max_tokens=800,
                system=self.system_prompt,
                temperature=0.5,
                messages=[{"role": "user", "content": prompt}]
            )
            
            response_text = response.content[0].text

            # Try to parse JSON from response — find the outermost { } block
            rating_data: dict = {"raw_response": response_text}
            brace_start = response_text.find("{")
            brace_end = response_text.rfind("}")
            if brace_start != -1 and brace_end > brace_start:
                try:
                    rating_data = json.loads(response_text[brace_start:brace_end + 1])
                except json.JSONDecodeError:
                    logger.warning("Failed to parse rating JSON from LLM response; storing raw text")
            
            return {
                "rater_agent_id": self.agent_id,
                "rater_name": self.name,
                "rating_data": rating_data,
                "timestamp": None
            }
            
        except Exception as e:
            logger.error(f"Error rating argument: {e}")
            raise


class GeminiDebateAgent(BaseDebateAgent):
    """Google Gemini-powered debate agent (free tier)."""

    DEFAULT_MODEL = "gemini-2.5-flash"

    def __init__(self, agent_id: str, name: str, persona: str, system_prompt: str):
        super().__init__(agent_id, name, persona, system_prompt)
        try:
            from google import genai
            from google.genai import types as genai_types
            self._client = genai.Client(api_key=settings.gemini_api_key)
            self._types = genai_types
            self.model_name = self.DEFAULT_MODEL
        except ImportError:
            logger.warning("google-genai not installed — Gemini agent disabled")
            self._client = None

    def _call(self, prompt: str, temperature: float = 0.7) -> str:
        if not self._client:
            return "Gemini unavailable — google-genai not installed."
        try:
            response = self._client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=self._types.GenerateContentConfig(
                    system_instruction=self.system_prompt,
                    temperature=temperature,
                ),
            )
            return response.text
        except Exception as e:
            logger.error(f"Gemini call failed: {e}")
            raise

    async def research_topic(self, topic: str, legislation_content: str = None) -> dict:
        prompt = f"""You are {self.name}, a {self.persona}.

Research this legislation topic: {topic}

{f"Legislation content: {legislation_content}" if legislation_content else ""}

Provide:
1. Key facts and context
2. Historical background
3. Current status and implications
4. Potential arguments for and against
5. Relevant data or statistics

Be thorough but concise. Focus on factual information."""
        try:
            text = self._call(prompt, temperature=0.3)
            return {"research": text, "source": "gemini", "confidence": "high"}
        except Exception as e:
            return {"research": f"Research failed: {e}", "source": "error"}

    async def generate_argument(
        self,
        legislation_title: str,
        legislation_summary: str,
        position: str,
        previous_arguments: list[dict[str, str]] = None,
        turn_number: int = 1,
        research_sources: list[dict] = None,
        conviction_level: int = 3,
        moderator_notes: list[str] = None,
    ) -> dict:
        conviction_labels = {
            1: "balanced and fair, acknowledging valid points on multiple sides",
            2: "thoughtful and measured, leaning toward your expert perspective",
            3: "clear and direct, expressing your perspective with strong reasoning",
            4: "confident and assertive in your analysis",
            5: "forceful and uncompromising in your view",
        }
        conviction_instruction = conviction_labels.get(conviction_level, conviction_labels[3])

        sources_block = ""
        if research_sources:
            sources_block = "\n\nResearch sources available to you:\n"
            for i, src in enumerate(research_sources[:6], 1):
                sources_block += f"{i}. {src.get('title', '')}\n"
                if src.get('snippet'):
                    sources_block += f"   {src['snippet'][:200]}\n"
                if src.get('url'):
                    sources_block += f"   URL: {src['url']}\n"

        prior_block = ""
        if previous_arguments:
            prior_block = "\n\nPrevious arguments in this debate:\n"
            for arg in previous_arguments:
                prior_block += f"- {arg.get('agent_name', 'Agent')}: {arg.get('argument', '')[:300]}\n"

        mod_notes_block = ""
        if moderator_notes:
            mod_notes_block = "\n\nRecent moderator corrections — take these into account:\n"
            for note in moderator_notes:
                mod_notes_block += f"- {note}\n"

        citation_instruction = (
            "- Only cite a source inline [N] if the specific claim you are making is directly supported by that source's snippet shown above. Do not cite a source for a claim not found in its snippet.\n"
            if research_sources else ""
        )

        prompt = f"""You are {self.name}, presenting as {self.persona}.

Bill: {legislation_title}
Summary: {legislation_summary}
{sources_block}{prior_block}{mod_notes_block}
Turn {turn_number}: Give your response to this debate as {self.name}. Be {conviction_instruction}.

Requirements:
- Speak naturally in first person — like a real person in a debate, not a policy report
- If a previous speaker has made a claim, directly challenge their strongest specific point with evidence or reasoning before making your own points
- Make 2-3 strong supporting points grounded in your expertise
- Reference specific evidence or data where possible
{citation_instruction}- End with a pointed question for the other participants (if applicable)

Keep your response focused and under 300 words."""

        try:
            temperature = min(0.9, 0.5 + (conviction_level - 1) * 0.1)
            argument = self._call(prompt, temperature=temperature)
            return {
                "agent_id": self.agent_id,
                "agent_name": self.name,
                "position": position,
                "argument": argument,
                "citations": _extract_cited_sources(argument, research_sources),
                "turn_number": turn_number,
            }
        except Exception as e:
            logger.error(f"Error generating argument for {self.name}: {e}")
            raise

    async def rate_argument(self, argument: str, context: str, criteria: list[str] = None) -> dict:
        if not criteria:
            criteria = ["persuasiveness", "logical_soundness", "factual_accuracy", "relevance"]
        prompt = f"""You are {self.name}, an expert evaluator in policy debates.

Rate the following argument on a scale of 1-10 for each criterion.

Context: {context}

Argument to Rate:
{argument}

Evaluation Criteria: {', '.join(criteria)}

Respond with JSON only, with keys: "scores" (dict of criterion→score), "reasoning", "overall_assessment", "strengths", "weaknesses"."""
        try:
            text = self._call(prompt, temperature=0.4)
            rating_data: dict = {"raw_response": text}
            brace_start = text.find("{")
            brace_end = text.rfind("}")
            if brace_start != -1 and brace_end > brace_start:
                try:
                    rating_data = json.loads(text[brace_start:brace_end + 1])
                except json.JSONDecodeError:
                    pass
            return {"rater_agent_id": self.agent_id, "rater_name": self.name,
                    "rating_data": rating_data, "timestamp": None}
        except Exception as e:
            logger.error(f"Error rating argument: {e}")
            raise


class LocalAIDebateAgent(BaseDebateAgent):
    """Ollama / OpenAI-compatible local model debate agent."""

    DEFAULT_MODEL = "llama3.1:8b"

    def __init__(self, agent_id: str, name: str, persona: str, system_prompt: str,
                 model_name: str = None, api_url: str = None):
        super().__init__(agent_id, name, persona, system_prompt)
        self.model_name = model_name or self.DEFAULT_MODEL
        base = (api_url or settings.ollama_url).rstrip("/")
        # Accept either a bare base URL or one that already includes /v1/...
        if "/v1/" in base:
            base = base.split("/v1/")[0]
        self._chat_url = f"{base}/v1/chat/completions"

    async def _call(self, messages: list[dict], temperature: float = 0.7) -> str:
        import httpx
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                self._chat_url,
                json={"model": self.model_name, "messages": messages,
                      "stream": False, "temperature": temperature,
                      "options": {"num_gpu": settings.ollama_num_gpu_layers}},
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    async def research_topic(self, topic: str, legislation_content: str = None) -> dict:
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": (
                f"Research this legislation topic: {topic}\n"
                f"{f'Legislation content: {legislation_content}' if legislation_content else ''}\n\n"
                "Provide key facts, context, and implications. Be factual and thorough."
            )},
        ]
        try:
            text = await self._call(messages, temperature=0.3)
            return {"research": text, "source": f"local_{self.model_name}", "confidence": "medium"}
        except Exception as e:
            return {"research": f"Local AI unavailable: {e}", "source": "error"}

    async def generate_argument(
        self,
        legislation_title: str,
        legislation_summary: str,
        position: str,
        previous_arguments: list[dict[str, str]] = None,
        turn_number: int = 1,
        research_sources: list[dict] = None,
        conviction_level: int = 3,
        moderator_notes: list[str] = None,
    ) -> dict:
        conviction_labels = {
            1: "balanced and fair, acknowledging valid points on multiple sides",
            2: "thoughtful and measured, leaning toward your expert perspective",
            3: "clear and direct, expressing your perspective with strong reasoning",
            4: "confident and assertive in your analysis",
            5: "forceful and uncompromising in your view",
        }
        conviction_instruction = conviction_labels.get(conviction_level, conviction_labels[3])

        sources_block = ""
        if research_sources:
            sources_block = "\n\nResearch sources:\n"
            for i, src in enumerate(research_sources[:6], 1):
                sources_block += f"{i}. {src.get('title', '')}\n"
                if src.get("snippet"):
                    sources_block += f"   {src['snippet'][:200]}\n"

        prior_block = ""
        if previous_arguments:
            prior_block = "\n\nPrevious arguments in this debate:\n"
            for arg in previous_arguments:
                prior_block += f"- {arg.get('agent_name', 'Agent')}: {arg.get('argument', '')[:300]}\n"

        mod_notes_block = ""
        if moderator_notes:
            mod_notes_block = "\n\nRecent moderator corrections — take these into account:\n"
            for note in moderator_notes:
                mod_notes_block += f"- {note}\n"

        citation_instruction = (
            "Only cite a source inline [N] if the specific claim you are making is directly supported by that source's snippet shown above. Do not cite a source for a claim not found in its snippet. "
            if research_sources else ""
        )

        user_msg = (
            f"Bill: {legislation_title}\nSummary: {legislation_summary}"
            f"{sources_block}{prior_block}{mod_notes_block}\n\n"
            f"Turn {turn_number}: Give your response to this debate as {self.name}. Be {conviction_instruction}.\n"
            "Speak naturally in first person — like a real person in a debate, not a policy report. "
            "If a previous speaker has made a claim, directly challenge their strongest specific point with evidence or reasoning before making your own points. "
            f"Make 2-3 strong supporting points grounded in your expertise. "
            f"{citation_instruction}"
            "End with a pointed question for the other participants. Keep it under 300 words."
        )

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_msg},
        ]
        try:
            temperature = min(0.9, 0.5 + (conviction_level - 1) * 0.1)
            argument = await self._call(messages, temperature=temperature)
            return {"agent_id": self.agent_id, "agent_name": self.name, "position": position,
                    "argument": argument, "citations": _extract_cited_sources(argument, research_sources),
                    "turn_number": turn_number}
        except Exception as e:
            logger.error(f"Error generating argument for {self.name}: {e}")
            raise

    async def rate_argument(self, argument: str, context: str, criteria: list[str] = None) -> dict:
        if not criteria:
            criteria = ["persuasiveness", "logical_soundness", "factual_accuracy", "relevance"]
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": (
                f"Rate this argument 1-10 for each: {', '.join(criteria)}\n\n"
                f"Context: {context}\nArgument: {argument}\n\n"
                'Respond with JSON only: {"scores": {"persuasiveness": N, "logical_soundness": N, '
                '"factual_accuracy": N, "relevance": N, "overall": N}, "reasoning": "..."}'
            )},
        ]
        try:
            text = await self._call(messages, temperature=0.3)
            rating_data: dict = {"raw_response": text}
            brace_start = text.find("{")
            brace_end = text.rfind("}")
            if brace_start != -1 and brace_end > brace_start:
                try:
                    rating_data = json.loads(text[brace_start:brace_end + 1])
                except json.JSONDecodeError:
                    pass
            return {"rater_agent_id": self.agent_id, "rater_name": self.name,
                    "rating_data": rating_data, "timestamp": None}
        except Exception as e:
            logger.error(f"Error rating argument: {e}")
            raise


class BYOAIDebateAgent(BaseDebateAgent):
    """Bring Your Own AI agent - users provide their own AI endpoint."""
    
    def __init__(self, agent_id: str, name: str, persona: str, system_prompt: str, 
                 api_url: str, api_key: str = None, headers: dict = None):
        super().__init__(agent_id, name, persona, system_prompt)
        self.api_url = api_url
        self.api_key = api_key
        self.headers = headers or {}
        if api_key:
            self.headers["Authorization"] = f"Bearer {api_key}"
    
    async def research_topic(self, topic: str, legislation_content: str = None) -> dict:
        """Research using user's AI."""
        try:
            import httpx
            
            payload = {
                "task": "research",
                "topic": topic,
                "legislation_content": legislation_content,
                "agent_name": self.name,
                "persona": self.persona
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.api_url,
                    json=payload,
                    headers=self.headers,
                    timeout=30
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "research": data.get("research", "No research provided"),
                        "source": "byo_ai",
                        "confidence": data.get("confidence", "unknown")
                    }
                else:
                    return {"research": f"BYO AI error: {response.status_code}", "source": "error"}
                    
        except Exception as e:
            return {"research": f"BYO AI unavailable: {e}", "source": "error"}
    
    async def generate_argument(self, legislation_title: str, legislation_summary: str, position: str,
                               previous_arguments=None, turn_number: int = 1,
                               research_sources: list[dict] = None, conviction_level: int = 3) -> dict:
        """Generate argument using user's AI."""
        try:
            import httpx
            
            payload = {
                "task": "generate_argument",
                "legislation_title": legislation_title,
                "legislation_summary": legislation_summary,
                "position": position,
                "previous_arguments": previous_arguments or [],
                "turn_number": turn_number,
                "agent_name": self.name,
                "persona": self.persona
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.api_url,
                    json=payload,
                    headers=self.headers,
                    timeout=30
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "agent_id": self.agent_id,
                        "agent_name": self.name,
                        "position": position,
                        "argument": data.get("argument", "No argument provided"),
                        "turn_number": turn_number
                    }
                else:
                    return {
                        "agent_id": self.agent_id,
                        "agent_name": self.name,
                        "position": position,
                        "argument": f"BYO AI error: {response.status_code}",
                        "turn_number": turn_number
                    }
                    
        except Exception as e:
            return {
                "agent_id": self.agent_id,
                "agent_name": self.name,
                "position": position,
                "argument": f"BYO AI unavailable: {e}",
                "turn_number": turn_number
            }
    
    async def rate_argument(self, argument: str, context: str, criteria=None) -> dict:
        """Rate argument using user's AI."""
        if not criteria:
            criteria = ["persuasiveness", "logical_soundness", "factual_accuracy", "relevance"]
        
        try:
            import httpx
            
            payload = {
                "task": "rate_argument",
                "argument": argument,
                "context": context,
                "criteria": criteria,
                "agent_name": self.name,
                "persona": self.persona
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.api_url,
                    json=payload,
                    headers=self.headers,
                    timeout=30
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "rater_agent_id": self.agent_id,
                        "rater_name": self.name,
                        "rating_data": data.get("rating", {"raw_response": "No rating provided"}),
                        "timestamp": None
                    }
                else:
                    return {
                        "rater_agent_id": self.agent_id,
                        "rating_data": {"error": f"BYO AI error: {response.status_code}"}
                    }
                    
        except Exception as e:
            return {
                "rater_agent_id": self.agent_id,
                "rating_data": {"error": f"BYO AI unavailable: {e}"}
            }


# Factory function to create agents
def create_agent(agent_type: str, **kwargs) -> BaseDebateAgent:
    """Factory to create different types of agents."""
    base = {k: kwargs[k] for k in ("agent_id", "name", "persona", "system_prompt") if k in kwargs}

    if agent_type == "claude":
        return ClaudeDebateAgent(**base)
    elif agent_type == "gemini":
        return GeminiDebateAgent(**base)
    elif agent_type == "local":
        return LocalAIDebateAgent(**base, model_name=kwargs.get("model_name") or "llama3.1:8b",
                                  api_url=kwargs.get("api_url"))
    elif agent_type == "byo":
        return BYOAIDebateAgent(
            **base,
            api_url=kwargs.get("api_url", ""),
            api_key=kwargs.get("api_key"),
        )
    else:
        raise ValueError(f"Unknown agent type: {agent_type}")


# Backwards compatibility
DebateAgent = ClaudeDebateAgent
