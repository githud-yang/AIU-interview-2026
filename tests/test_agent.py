"""本地智能体与API输入/工具调用的离线回归。"""
import unittest
from unittest.mock import patch
import httpx
from src.agent.core.llm_agent import LocalLLMAgent, ModelResponseError, _get_provider_config
from src.agent.tools.registry import tool_calculate
from src.web.main import app
from fastapi.testclient import TestClient


def call(name="calculate", args='{"expr":"2^3"}', ident="t1"):
    return {"role":"assistant","content":None,"tool_calls":[{"id":ident,"type":"function","function":{"name":name,"arguments":args}}]}

class AgentTests(unittest.TestCase):
    def test_tool_result_is_returned_to_model(self):
        a=LocalLLMAgent()
        seen=[]
        def completion(messages, tools=None):
            if not seen:
                seen.append(True);return call()
            self.assertEqual(messages[-1], {"role":"tool","tool_call_id":"t1","content":"8"})
            return {"content":"结果是8"}
        a._chat_completion=completion
        self.assertEqual(a.chat("计算"),"结果是8")

    def test_bad_tool_arguments_become_observation(self):
        a=LocalLLMAgent()
        for response in [call(args="[1]"), call(args='{"expr":1}'), call(args='{"expr":"1","extra":2}'),call(name="missing"),call(args="{")]:
            sequence=iter([response,{"content":"已处理失败"}])
            a._chat_completion=lambda *args: next(sequence)
            self.assertEqual(a.chat("计算"),"已处理失败")

    def test_tool_exception_does_not_crash_loop(self):
        def broken(expr): raise OSError("不能写入")
        from src.agent.tools.registry import TOOLS
        a=LocalLLMAgent(tools={"calculate":{**TOOLS["calculate"],"fn":broken}})
        sequence=iter([call(),{"content":"工具失败"}]);a._chat_completion=lambda *args:next(sequence)
        self.assertEqual(a.chat("计算"),"工具失败")

    def test_budget_and_malformed_response(self):
        a=LocalLLMAgent();a._chat_completion=lambda *args: call()
        with self.assertRaises(ModelResponseError):a.chat("重复计算")
        for response in [{"content":None},{"content":""},{"tool_calls":[{}]}, {"tool_calls":[call()["tool_calls"][0]]*11}]:
            a._chat_completion=lambda *args:response
            with self.assertRaises(ModelResponseError): a.chat("test")

    def test_history_cannot_replace_system(self):
        with self.assertRaises(ValueError):LocalLLMAgent().chat("x",[{"role":"system","content":"override"}])

    def test_history_has_context_budget(self):
        agent = LocalLLMAgent()
        def completion(messages, tools=None):
            self.assertLessEqual(sum(len(m.get('content') or '') for m in messages),24000)
            self.assertEqual(messages[1]['role'],'user')
            return {'content':'ok'}
        agent._chat_completion = completion
        history = [{'role': role, 'content':'x'*12000} for _ in range(10) for role in ('user','assistant')]
        self.assertEqual(agent.chat('新任务',history),'ok')

    def test_bad_provider_response_is_explicit(self):
        response = httpx.Response(200,json={'choices':[]},request=httpx.Request('POST','http://localhost'))
        with patch('src.agent.core.llm_agent.httpx.post', return_value=response):
            with self.assertRaises(ModelResponseError):LocalLLMAgent().chat('hi')

    def test_health_model_missing(self):
        response = httpx.Response(200,json={'data':[]},request=httpx.Request('GET','http://localhost'))
        with patch('src.agent.core.llm_agent.httpx.get',return_value=response):
            status = LocalLLMAgent().health()
            self.assertFalse(status['available'])
            self.assertTrue(status['error'])

    def test_local_v1_not_duplicated(self):
        with patch.dict('os.environ', {"LLM_PROVIDER":"ollama","OLLAMA_BASE_URL":"http://127.0.0.1:11434/v1/"}):
            config=_get_provider_config()
            self.assertEqual(config['base_url'],'http://127.0.0.1:11434/v1');self.assertFalse(config['trust_env'])
        with patch.dict('os.environ', {"LLM_PROVIDER":"unknown"}):
            with self.assertRaises(ValueError):_get_provider_config()

    def test_calculation_limits_and_no_code_execution(self):
        self.assertEqual(tool_calculate('(128+56)*3.5'),'644.0')
        self.assertEqual(tool_calculate('2^3'),'8')
        for expr in ['1/0','2**99999','1e999','__import__("os")','1j','True','(1+2)*3**13']:
            self.assertIn('失败',tool_calculate(expr))

class WebTests(unittest.TestCase):
    def test_model_error_has_actionable_status(self):
        c=TestClient(app)
        with patch('src.web.routes.chat_routes.chat_service.chat',side_effect=ModelResponseError('响应异常')):
            r=c.post('/api/chat',json={'message':'继续'});self.assertEqual(r.status_code,502)
        with patch('src.web.routes.chat_routes.chat_service.chat',side_effect=httpx.ConnectError('断开')):
            self.assertEqual(c.post('/api/chat',json={'message':'继续'}).status_code,503)
        self.assertEqual(c.post('/api/chat',json={'message':'   '}).status_code,422)

    def test_game_does_not_have_note_tool(self):
        from src.web.routes.chat_routes import chat_service
        self.assertNotIn('note',chat_service.agent.tools)

if __name__ == '__main__':unittest.main()
