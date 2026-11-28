# 가상 답안 첨삭 검증

`npm run dev`로 앱을 시작하고 `http://localhost:5173/?demo=1`을 엽니다. 교사 체험에서 가상 반의 미분·적분 시험을 선택하면 등록된 문항과 평가 기준, 예시 답안에 대한 첨삭 결과를 확인할 수 있습니다. 학생 체험에서는 교사가 공개한 결과가 보입니다.

로컬 회귀 테스트는 가상 문제·평가 기준·답안을 만든 다음 교사의 부분점수와 피드백을 검증합니다. 범위를 벗어난 점수를 거부하고 교사 검토 후 공개한 합계와 피드백을 학생이 볼 수 있는지 확인합니다.

```sh
npm run install:app
node --test mathgrade-studio/tests/product-demo.test.mjs
npm run test
npm run check
npm run build
```

데모의 분석 API는 구성되지 않은 상태를 재현합니다. 테스트 데이터와 채점 예시는 동작 검증용이며 실제 답안 채점 정확도는 별도 전문가 검증이 필요합니다.
