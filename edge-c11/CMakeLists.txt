cmake_minimum_required(VERSION 3.16)
project(OmniCyberDexEdge C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
option(OCD_BUILD_TESTS "Build tests" ON)
add_library(ocd_core
  src/ocd_core.c
  src/ocd_json.c
  src/ocd_signal.c
  src/ocd_cache.c
  src/ocd_adapter_mock.c
)
target_include_directories(ocd_core PUBLIC include)
if(MSVC)
  target_compile_options(ocd_core PRIVATE /W4)
else()
  target_compile_options(ocd_core PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
add_executable(omnicyberdex-edge src/main.c src/ocd_http.c)
target_link_libraries(omnicyberdex-edge PRIVATE ocd_core)
if(WIN32)
  target_link_libraries(omnicyberdex-edge PRIVATE ws2_32)
endif()
if(OCD_BUILD_TESTS)
  enable_testing()
  add_executable(ocd_tests tests/test_core.c)
  target_link_libraries(ocd_tests PRIVATE ocd_core)
  add_test(NAME ocd_tests COMMAND ocd_tests)
endif()
install(TARGETS omnicyberdex-edge RUNTIME DESTINATION bin)
