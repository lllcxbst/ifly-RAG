from app.services.rag import _refusal_answer, choose_retrieval_plan, classify_question


def test_category_classifier() -> None:
    assert classify_question("这个产品支持哪些场景") == "capability"
    assert classify_question("接口应该如何调用") == "usage"
    assert classify_question("返回 AUTH_001 报错怎么办") == "troubleshooting"
    assert classify_question("调用返回 AUTH_001 怎么解决") == "troubleshooting"


def test_adaptive_retrieval_router() -> None:
    assert choose_retrieval_plan("AUTH_001 报错怎么解决").mode == "semantic"
    assert choose_retrieval_plan("鉴权服务和应用 ID 之间是什么关系？").mode == "graph"
    assert choose_retrieval_plan("对比同步接口和异步任务的区别，并分别说明调用步骤").mode == "parallel"
    assert choose_retrieval_plan("请综合说明产品的能力、适用场景以及完整接入流程").mode == "parallel"


def test_refusal_message_has_one_handoff_instruction() -> None:
    answer = _refusal_answer("请联系部门技术支持")
    assert "请请联系" not in answer
    assert answer.count("请联系部门技术支持") == 1
